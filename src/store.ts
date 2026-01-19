/***FILE_CONTENT_START***/
/**
 * NexusFlow Gatekeeper - State Store
 *
 * Implements the Healer Protocol for reliable distributed state synchronization.
 * Uses Zustand for state management with persistence.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger.js';
import {
  sendViaTransport,
  sendAck,
  getChannel,
  generateMessageId,
  getTransportType,
  ReliableMessage,
} from './transport/index.js';
import type { TransportType } from './transport/index.js';

// ============================================
// TYPES
// ============================================

export type NodeState = 'normal' | 'warning' | 'emergency';

export interface RoboticNode {
  id: string;
  label: string;
  position: { x: number; y: number };
  state: NodeState;
}

interface PendingMessage {
  message: ReliableMessage;
  acknowledged: boolean;
  lastAttempt: number;
}

interface NexusStore {
  // State
  nodes: RoboticNode[];
  pendingMessages: Map<string, PendingMessage>;
  appliedMessageIds: Set<string>;

  // Actions
  setNodeState: (nodeId: string, state: NodeState) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodes: (nodes: RoboticNode[]) => void;
  handleReliableMessage: (message: ReliableMessage) => boolean;
  acknowledgeMessage: (messageId: string) => void;
  retryPendingMessages: () => void;
  cleanupAcknowledgedMessages: () => void;
  markMessageApplied: (messageId: string) => void;

  // Configuration
  chaosConfig: {
    packetLossRate: number;
    minLatency: number;
    maxLatency: number;
  };
  setChaosConfig: (config: Partial<NexusStore['chaosConfig']>) => void;

  // Metrics
  metrics: {
    messagesSent: number;
    messagesReceived: number;
    acksReceived: number;
    retries: number;
    lastLatency: number;
  };
}

// ============================================
// CONSTANTS
// ============================================

const ACK_TIMEOUT_MS = 300;
const MAX_RETRY_ATTEMPTS = 5;
const CLEANUP_DELAY_MS = 5000;

// Client ID - generated once per browser context
let _clientId: string | null = null;
export function getClientId(): string {
  if (!_clientId && typeof window !== 'undefined') {
    _clientId = `client-${uuidv4().substring(0, 8)}`;
  }
  return _clientId || 'server';
}

// ============================================
// INITIAL STATE
// ============================================

const initialNodes: RoboticNode[] = [
  { id: 'robot-alpha', label: 'Robot-Alpha', position: { x: 100, y: 100 }, state: 'normal' },
  { id: 'robot-beta', label: 'Robot-Beta', position: { x: 400, y: 100 }, state: 'normal' },
  { id: 'robot-gamma', label: 'Robot-Gamma', position: { x: 700, y: 100 }, state: 'normal' },
  { id: 'robot-delta', label: 'Robot-Delta', position: { x: 250, y: 300 }, state: 'normal' },
  { id: 'robot-epsilon', label: 'Robot-Epsilon', position: { x: 550, y: 300 }, state: 'normal' },
];

// ============================================
// BACKGROUND LOOPS
// ============================================

let _retryIntervalId: ReturnType<typeof setInterval> | null = null;
let _cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

// ============================================
// STORE IMPLEMENTATION
// ============================================

export const useNexusStore = create<NexusStore>()(
  persist<NexusStore>(
    (set, get) => ({
      // Initial State
      nodes: initialNodes,
      pendingMessages: new Map(),
      appliedMessageIds: new Set(),
      metrics: {
        messagesSent: 0,
        messagesReceived: 0,
        acksReceived: 0,
        retries: 0,
        lastLatency: 0,
      },
      chaosConfig: {
        packetLossRate: 0,
        minLatency: 0,
        maxLatency: 0,
      },

      /**
       * Set a node's state - triggers the Healer Protocol ACK loop
       */
      setNodeState: (nodeId, state) => {
        const clientId = getClientId();
        const message = sendReliableMessageInternal(
          'NODE_STATE_CHANGE',
          { nodeId, state },
          clientId
        );

        // Track pending message for retry logic
        const pendingMessages = new Map(get().pendingMessages);
        pendingMessages.set(message.id, {
          message,
          acknowledged: false,
          lastAttempt: Date.now(),
        });

        set((store) => ({
          nodes: store.nodes.map((n) =>
            n.id === nodeId ? { ...n, state } : n
          ),
          pendingMessages,
          metrics: { ...store.metrics, messagesSent: store.metrics.messagesSent + 1 }
        }));

        logger.info({ nodeId, state, msgId: message.id }, 'Node state changed');
      },

      /**
       * Update a node's position (for animations)
       */
      updateNodePosition: (nodeId, position) =>
        set((store) => ({
          nodes: store.nodes.map((n) =>
            n.id === nodeId ? { ...n, position } : n
          ),
        })),

      /**
       * Set all nodes (for state sync)
       */
      setNodes: (nodes) => set({ nodes }),

      /**
       * Handle incoming reliable messages
       */
      handleReliableMessage: (message) => {
        const { type, payload, id, senderId } = message;
        const clientId = getClientId();

        // Check if already applied (duplicate detection)
        if (get().appliedMessageIds.has(id)) {
          if (senderId !== clientId) {
            sendAck(id, clientId);
          }
          return true;
        }

        // Ignore own messages
        if (senderId === clientId) {
          return false;
        }

        logger.debug({ msgId: id, type, senderId }, 'Received message');

        // Update RX metrics
        set(s => ({
          metrics: { ...s.metrics, messagesReceived: s.metrics.messagesReceived + 1 }
        }));

        switch (type) {
          case 'NODE_STATE_CHANGE': {
            const { nodeId, state } = payload as { nodeId: string; state: NodeState };
            set((store) => ({
              nodes: store.nodes.map((n) =>
                n.id === nodeId ? { ...n, state } : n
              ),
              appliedMessageIds: new Set([...store.appliedMessageIds, id]),
            }));
            logger.debug({ nodeId, state }, 'Applied state change');
            return true;
          }

          case 'STATE_SYNC': {
            const nodes = payload as RoboticNode[];
            set((store) => ({
              nodes,
              appliedMessageIds: new Set([...store.appliedMessageIds, id]),
            }));
            logger.debug({ nodeCount: nodes.length }, 'Applied state sync');
            return true;
          }

          case 'ACKNOWLEDGEMENT': {
            const pendingMessages = new Map(get().pendingMessages);
            const ackPayload = payload as { messageId: string };
            const originalId = ackPayload.messageId;
            const pending = pendingMessages.get(originalId);

            if (pending) {
              pending.acknowledged = true;
              pendingMessages.set(originalId, pending);

              const latency = Date.now() - pending.lastAttempt;

              set(s => ({
                pendingMessages,
                metrics: {
                  ...s.metrics,
                  acksReceived: s.metrics.acksReceived + 1,
                  lastLatency: latency
                }
              }));

              logger.debug({ msgId: originalId, latency }, 'Received acknowledgement');
            }
            return true;
          }

          default:
            logger.warn({ type }, 'Unknown message type');
            return false;
        }
      },

      /**
       * Send acknowledgement for a received message
       */
      acknowledgeMessage: (messageId) => {
        sendAck(messageId, getClientId());
        logger.debug({ msgId: messageId }, 'Sent acknowledgement');
      },

      /**
       * Mark message as locally applied
       */
      markMessageApplied: (messageId) => {
        set((store) => ({
          appliedMessageIds: new Set([...store.appliedMessageIds, messageId]),
        }));
      },

      /**
       * Retry unacknowledged messages
       */
      retryPendingMessages: () => {
        const { pendingMessages, chaosConfig } = get();
        const now = Date.now();
        const newPendingMessages = new Map(pendingMessages);
        let hasChanges = false;

        pendingMessages.forEach((pending, messageId) => {
          if (pending.acknowledged) return;

          const timeSinceLastAttempt = now - pending.lastAttempt;
          if (timeSinceLastAttempt < ACK_TIMEOUT_MS) return;

          if (pending.message.attempts >= MAX_RETRY_ATTEMPTS) {
            logger.warn({ msgId: messageId, attempts: MAX_RETRY_ATTEMPTS }, 'Message failed after max attempts');
            pending.acknowledged = true;
            newPendingMessages.set(messageId, pending);
            hasChanges = true;
            return;
          }

          // Chaos Engineering: Packet Loss Simulation
          if (chaosConfig.packetLossRate > 0 && Math.random() < chaosConfig.packetLossRate) {
            logger.debug({ msgId: messageId, rate: chaosConfig.packetLossRate }, 'Chaos: Packet dropped');
            // Update lastAttempt to prevent rapid retries
            pending.lastAttempt = now;
            newPendingMessages.set(messageId, pending);
            hasChanges = true;
            return;
          }

          const newAttempt = pending.message.attempts + 1;
          const retryMessage = { ...pending.message, attempts: newAttempt, timestamp: now };

          // Send retry via transport
          sendViaTransport(retryMessage);

          newPendingMessages.set(messageId, {
            ...pending,
            message: retryMessage,
            lastAttempt: now,
          });

          set(s => ({ metrics: { ...s.metrics, retries: s.metrics.retries + 1 } }));
          hasChanges = true;

          if (newAttempt > 3) {
            logger.warn({ msgId: messageId, attempt: newAttempt }, 'Message retry warning');
          }
        });

        if (hasChanges) {
          set({ pendingMessages: newPendingMessages });
        }
      },

      /**
       * Clean up old messages to prevent memory leaks
       */
      cleanupAcknowledgedMessages: () => {
        const { pendingMessages, appliedMessageIds } = get();
        const now = Date.now();
        const newPendingMessages = new Map<string, PendingMessage>();
        const newAppliedIds = new Set<string>();
        let cleanedCount = 0;

        pendingMessages.forEach((pending, messageId) => {
          // Keep unacknowledged messages
          if (!pending.acknowledged) {
            newPendingMessages.set(messageId, pending);
            return;
          }

          // Keep recently acknowledged messages
          const timeSinceAck = now - pending.lastAttempt;
          if (timeSinceAck < CLEANUP_DELAY_MS) {
            newPendingMessages.set(messageId, pending);
          } else {
            cleanedCount++;
          }
        });

        // Clean up old applied IDs
        let cleanedAppliedCount = 0;
        appliedMessageIds.forEach((id) => {
          // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
          const timestampPart = id.substring(0, 8);
          const timestamp = parseInt(timestampPart, 16) * 4294966.296; // Approximate conversion
          if (now - timestamp < CLEANUP_DELAY_MS * 1000) {
            newAppliedIds.add(id);
          } else {
            cleanedAppliedCount++;
          }
        });

        if (cleanedCount > 0 || cleanedAppliedCount > 0) {
          logger.debug({ cleanedMessages: cleanedCount, cleanedApplied: cleanedAppliedCount }, 'Cleanup completed');
          set({
            pendingMessages: newPendingMessages,
            appliedMessageIds: newAppliedIds,
          });
        }
      },

      /**
       * Update chaos configuration
       */
      setChaosConfig: (config) => set((state) => ({
        chaosConfig: { ...state.chaosConfig, ...config }
      })),
    }),
    {
      name: 'nexusflow-storage',
      /**
       * Custom merge for Map/Set serialization
       */
      merge: (persistedState: unknown, currentState: NexusStore): NexusStore => {
        if (!persistedState) return currentState;

        const converted: NexusStore = { ...currentState } as NexusStore;
        const psAny = persistedState as any;

        if (psAny.pendingMessages) {
          const map = new Map<string, PendingMessage>();
          Object.entries(psAny.pendingMessages).forEach(([key, value]) => {
            map.set(key, value as PendingMessage);
          });
          converted.pendingMessages = map;
        }

        if (psAny.appliedMessageIds) {
          converted.appliedMessageIds = new Set<string>(psAny.appliedMessageIds as string[]);
        }

        return converted;
      },
      onRehydrateStorage: () => (state?: NexusStore) => {
        if (typeof window === 'undefined' || !state) return;

        // Initialize transport listener
        const listenerChannel = getChannel();
        if (listenerChannel) {
          listenerChannel.onmessage = (event) => {
            const message = event.data as ReliableMessage;
            const handled = state?.handleReliableMessage(message);

            if (handled && message.type !== 'ACKNOWLEDGEMENT') {
              state?.acknowledgeMessage(message.id);
            }
          };
        }

        // Start retry loop
        if (_retryIntervalId) clearInterval(_retryIntervalId);
        _retryIntervalId = setInterval(() => {
          state?.retryPendingMessages();
        }, ACK_TIMEOUT_MS);
        logger.debug({ interval: ACK_TIMEOUT_MS }, 'Retry loop started');

        // Start cleanup loop
        if (_cleanupIntervalId) clearInterval(_cleanupIntervalId);
        _cleanupIntervalId = setInterval(() => {
          state?.cleanupAcknowledgedMessages();
        }, CLEANUP_DELAY_MS);
        logger.debug({ interval: CLEANUP_DELAY_MS }, 'Cleanup loop started');

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
          if (_retryIntervalId) clearInterval(_retryIntervalId);
          if (_cleanupIntervalId) clearInterval(_cleanupIntervalId);
        });
      },
    }
  )
);

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Send a reliable message with optional chaos injection
 */
function sendReliableMessageInternal<T>(
  type: ReliableMessage['type'],
  payload: T,
  senderId: string
): ReliableMessage<T> {
  const { chaosConfig } = useNexusStore.getState();

  // Chaos Engineering: Packet Loss Simulation
  if (chaosConfig.packetLossRate > 0 && Math.random() < chaosConfig.packetLossRate) {
    logger.debug({ rate: chaosConfig.packetLossRate }, 'Chaos: Packet dropped');
    return {
      id: generateMessageId(),
      type,
      payload,
      timestamp: Date.now(),
      senderId,
      attempts: 0,
      maxAttempts: MAX_RETRY_ATTEMPTS,
    };
  }

  const message: ReliableMessage<T> = {
    id: generateMessageId(),
    type,
    payload,
    timestamp: Date.now(),
    senderId,
    attempts: 0,
    maxAttempts: MAX_RETRY_ATTEMPTS,
  };

  // Apply latency chaos if configured
  if (chaosConfig.minLatency > 0 || chaosConfig.maxLatency > 0) {
    const latency = chaosConfig.minLatency +
      Math.random() * (chaosConfig.maxLatency - chaosConfig.minLatency);
    setTimeout(() => sendViaTransport(message), latency);
  } else {
    sendViaTransport(message);
  }

  return message;
}

// ============================================
// EXPORTS
// ============================================

export { getTransportType };
export type { TransportType };
export const robotAlphaPath: { x: number; y: number }[] = [
  { x: 100, y: 100 },
  { x: 150, y: 150 },
  { x: 200, y: 200 },
  { x: 250, y: 150 },
  { x: 200, y: 100 },
  { x: 150, y: 100 },
];
/***FILE_CONTENT_END***/
