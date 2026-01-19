/**
 * Transport Layer
 *
 * Handles message transmission via BroadcastChannel or WebSocket
 * Part of the Healer Protocol for reliable distributed messaging
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// ============================================
// TYPES
// ============================================

export interface ReliableMessage<T = unknown> {
  id: string;              // UUID format
  type: 'NODE_STATE_CHANGE' | 'STATE_SYNC' | 'ACKNOWLEDGEMENT';
  payload: T;
  timestamp: number;
  senderId: string;
  attempts: number;
  maxAttempts: number;
}

export type TransportType = 'broadcastchannel' | 'websocket';

// ============================================
// TRANSPORT STATE
// ============================================

let _channel: BroadcastChannel | null = null;
let _socket: unknown = null;
let _socketConnected = false;
let _transportType: TransportType = 'broadcastchannel';

// ============================================
// UUID GENERATION
// ============================================

/**
 * Generate a unique message ID using UUID v4
 */
export function generateMessageId(): string {
  return uuidv4();
}

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
  return `client-${uuidv4().substring(0, 8)}`;
}

// ============================================
// BROADCAST CHANNEL (Development)
// ============================================

/**
 * Get or create the BroadcastChannel for cross-tab sync
 */
export function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!_channel) {
    _channel = new BroadcastChannel('nexusflow-sync');
  }
  return _channel;
}

/**
 * Send a message via BroadcastChannel
 */
export function sendViaBroadcastChannel(message: ReliableMessage): void {
  const channel = getChannel();
  if (channel) {
    channel.postMessage(message);
    logger.debug({ msgId: message.id, type: message.type }, 'Sent via BroadcastChannel');
  }
}

/**
 * Close BroadcastChannel (cleanup)
 */
export function closeBroadcastChannel(): void {
  if (_channel) {
    _channel.close();
    _channel = null;
  }
}

// ============================================
// WEBSOCKET (Production)
// ============================================

/**
 * Initialize WebSocket connection
 */
export async function initWebSocket(
  wsUrl: string,
  authToken: string
): Promise<unknown> {
  if (typeof window === 'undefined') return null;

  _transportType = 'websocket';

  try {
    const { io } = await import('socket.io-client');
    _socket = io(wsUrl, {
      transports: ['websocket'],
      auth: { token: authToken },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const socket = _socket as { on: (event: string, cb: unknown) => void };

    socket.on('connect', () => {
      _socketConnected = true;
      logger.info('WebSocket connected');
    });

    socket.on('disconnect', () => {
      _socketConnected = false;
      logger.warn('WebSocket disconnected');
    });

    logger.info({ wsUrl }, 'WebSocket client connecting');
    return _socket;
  } catch (error) {
    logger.warn({ error }, 'WebSocket initialization failed, falling back to BroadcastChannel');
    _transportType = 'broadcastchannel';
    return null;
  }
}

/**
 * Send a message via WebSocket
 */
export function sendViaWebSocket(message: ReliableMessage): void {
  if (_socket && _socketConnected) {
    const socket = _socket as { emit: (event: string, msg: ReliableMessage) => void };
    socket.emit('message:send', message);
    logger.debug({ msgId: message.id, type: message.type }, 'Sent via WebSocket');
  }
}

/**
 * Close WebSocket connection
 */
export function closeWebSocket(): void {
  if (_socket) {
    const socket = _socket as { disconnect: () => void };
    socket.disconnect();
    _socket = null;
    _socketConnected = false;
  }
}

// ============================================
// UNIFIED TRANSPORT API
// ============================================

/**
 * Send a reliable message via the current transport
 */
export function sendViaTransport(message: ReliableMessage): void {
  if (_transportType === 'websocket' && _socket && _socketConnected) {
    sendViaWebSocket(message);
  } else {
    sendViaBroadcastChannel(message);
  }
}

/**
 * Send an acknowledgement via the current transport
 */
export function sendAck(messageId: string, senderId: string): void {
  const ack: ReliableMessage<{ messageId: string }> = {
    id: generateMessageId(),
    type: 'ACKNOWLEDGEMENT',
    payload: { messageId },
    timestamp: Date.now(),
    senderId,
    attempts: 0,
    maxAttempts: 1,
  };

  if (_transportType === 'websocket' && _socket && _socketConnected) {
    const socket = _socket as { emit: (event: string, msg: ReliableMessage) => void };
    socket.emit('message:ack', ack);
  } else {
    sendViaBroadcastChannel(ack);
  }
}

/**
 * Get the current transport type
 */
export function getTransportType(): TransportType {
  return _transportType;
}

/**
 * Check if WebSocket is connected
 */
export function isWebSocketConnected(): boolean {
  return _socketConnected;
}

/**
 * Set the transport type (for testing)
 */
export function setTransportType(type: TransportType): void {
  _transportType = type;
}

/**
 * Cleanup all transport resources
 */
export function cleanupTransport(): void {
  closeBroadcastChannel();
  closeWebSocket();
}

export type { ReliableMessage as Message };