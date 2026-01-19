/**
 * WebSocket Backend - Message Store
 * In-memory queue for reliable message delivery with ACK support
 */

import { EventEmitter } from 'events';

export interface QueuedMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
  senderId: string;
  attempts: number;
  maxAttempts: number;
  acknowledged: boolean;
}

export interface MessageStoreEvents {
  'message:sent': [QueuedMessage];
  'message:acknowledged': [string];
  'message:failed': [string, string];
}

export class MessageStore extends EventEmitter<MessageStoreEvents> {
  private pendingMessages: Map<string, QueuedMessage> = new Map();
  private deliveredMessages: Map<string, QueuedMessage> = new Map();
  private readonly MAX_AGE_MS = 60000; // Messages expire after 60s

  /**
   * Add a message to the pending queue
   */
  add(message: QueuedMessage): void {
    this.pendingMessages.set(message.id, message);
    this.emit('message:sent', message);
    console.log(`[MESSAGE-STORE] Added message ${message.id} to queue (${this.pendingMessages.size} pending)`);
  }

  /**
   * Mark a message as acknowledged
   */
  acknowledge(messageId: string): boolean {
    const message = this.pendingMessages.get(messageId);
    if (!message) {
      // Check if already delivered
      const delivered = this.deliveredMessages.get(messageId);
      if (delivered) {
        console.log(`[MESSAGE-STORE] Message ${messageId} already acknowledged`);
        return true;
      }
      console.warn(`[MESSAGE-STORE] Cannot acknowledge unknown message: ${messageId}`);
      return false;
    }

    message.acknowledged = true;
    this.pendingMessages.delete(messageId);
    this.deliveredMessages.set(messageId, message);
    this.emit('message:acknowledged', messageId);

    console.log(`[MESSAGE-STORE] Message ${messageId} acknowledged (${this.pendingMessages.size} pending)`);
    return true;
  }

  /**
   * Get pending messages that need retry
   */
  getPendingForRetry(ackTimeoutMs: number): QueuedMessage[] {
    const now = Date.now();
    const toRetry: QueuedMessage[] = [];

    this.pendingMessages.forEach((message) => {
      if (message.acknowledged) return;
      if (message.attempts >= message.maxAttempts) {
        this.emit('message:failed', message.id, 'Max attempts reached');
        return;
      }

      const timeSinceSend = now - message.timestamp;
      if (timeSinceSend >= ackTimeoutMs) {
        toRetry.push(message);
      }
    });

    return toRetry;
  }

  /**
   * Increment attempt count for a message
   */
  incrementAttempts(messageId: string): void {
    const message = this.pendingMessages.get(messageId);
    if (message) {
      message.attempts++;
      console.log(`[MESSAGE-STORE] Message ${messageId} attempt ${message.attempts}/${message.maxAttempts}`);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    delivered: number;
    pendingIds: string[];
  } {
    return {
      pending: this.pendingMessages.size,
      delivered: this.deliveredMessages.size,
      pendingIds: Array.from(this.pendingMessages.keys()),
    };
  }

  /**
   * Clear old delivered messages
   */
  cleanup(maxAgeMs: number = this.MAX_AGE_MS): number {
    const now = Date.now();
    let removed = 0;

    this.deliveredMessages.forEach((message, id) => {
      if (now - message.timestamp > maxAgeMs) {
        this.deliveredMessages.delete(id);
        removed++;
      }
    });

    if (removed > 0) {
      console.log(`[MESSAGE-STORE] Cleaned up ${removed} old delivered messages`);
    }

    return removed;
  }

  /**
   * Clear all messages (for testing)
   */
  clear(): void {
    this.pendingMessages.clear();
    this.deliveredMessages.clear();
    console.log(`[MESSAGE-STORE] Store cleared`);
  }
}

// Singleton instance for the server
export const messageStore = new MessageStore();
