/**
 * NexusFlow Gatekeeper - WebSocket Server
 *
 * Real-time messaging backend with ACK support
 * Replaces BroadcastChannel for multi-tab and multi-device sync
 */

import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { messageStore, QueuedMessage } from './messageStore.js';

// ============================================
// CONFIGURATION & VALIDATION
// ============================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validate required secrets
const NEXUS_SECRET = process.env.NEXUS_SECRET;
if (!NEXUS_SECRET || NEXUS_SECRET === 'change-this-in-production') {
  console.error('❌ ERROR: NEXUS_SECRET environment variable is required');
  console.error('   Set NEXUS_SECRET in your .env file');
  process.exit(1);
}

const VITE_NEXUS_TOKEN = process.env.VITE_NEXUS_TOKEN;
if (!VITE_NEXUS_TOKEN || VITE_NEXUS_TOKEN === 'change-this-in-production') {
  console.error('❌ ERROR: VITE_NEXUS_TOKEN environment variable is required');
  console.error('   Set VITE_NEXUS_TOKEN in your .env file');
  process.exit(1);
}

// ============================================
// LOGGER SETUP
// ============================================

const logger = pino({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  transport: NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined,
  base: { service: 'nexusflow-gatekeeper' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ============================================
// CLIENT TRACKING
// ============================================

interface ClientInfo {
  socket: Socket;
  lastSeen: number;
  clientId: string;
  connectedAt: number;
}

const clients = new Map<string, ClientInfo>();

// Rate limiting: messages per second per client
const RATE_LIMIT_MSGS_PER_SEC = 100;
const rateLimitTracker = new Map<string, { count: number; resetTime: number }>();

// ============================================
// HTTP SERVER SETUP
// ============================================

const app = express();
const httpServer = createServer(app);

// Health check endpoint
app.get('/health', (_, res) => {
  res.json({
    status: 'healthy',
    clients: clients.size,
    pendingMessages: messageStore.getStats().pending,
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

// Metrics endpoint for monitoring
app.get('/metrics', (_, res) => {
  const stats = messageStore.getStats();
  const clientList = Array.from(clients.values()).map(c => ({
    clientId: c.clientId,
    lastSeen: c.lastSeen,
    connectedAt: c.connectedAt,
  }));

  res.json({
    ...stats,
    clients: clientList,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    loadAvg: process.loadavg(),
  });
});

// ============================================
// SOCKET.IO SETUP WITH SECURITY
// ============================================

const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============================================
// RATE LIMITING HELPER
// ============================================

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const tracker = rateLimitTracker.get(clientId);

  if (!tracker || tracker.resetTime < now) {
    rateLimitTracker.set(clientId, { count: 1, resetTime: now + 1000 });
    return true;
  }

  if (tracker.count >= RATE_LIMIT_MSGS_PER_SEC) {
    logger.warn({ clientId, count: tracker.count }, 'Rate limit exceeded');
    return false;
  }

  tracker.count++;
  return true;
}

// ============================================
// MESSAGE VALIDATION
// ============================================

interface ClientMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
  senderId: string;
  attempts: number;
  maxAttempts: number;
}

function validateMessage(data: unknown): data is ClientMessage {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const msg = data as Record<string, unknown>;

  // Required fields check
  if (typeof msg.id !== 'string' || !msg.id) {
    logger.warn({ data }, 'Invalid message: missing or invalid id');
    return false;
  }

  if (typeof msg.type !== 'string' || !msg.type) {
    logger.warn({ data }, 'Invalid message: missing or invalid type');
    return false;
  }

  if (typeof msg.senderId !== 'string' || !msg.senderId) {
    logger.warn({ data }, 'Invalid message: missing or invalid senderId');
    return false;
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(msg.id)) {
    logger.warn({ id: msg.id }, 'Invalid message: id is not a valid UUID');
    return false;
  }

  return true;
}

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    logger.warn({ socketId: socket.id }, 'Auth failed: missing token');
    return next(new Error('Authentication error: Missing token'));
  }

  if (token !== VITE_NEXUS_TOKEN) {
    logger.warn({ socketId: socket.id }, 'Auth failed: invalid token');
    return next(new Error('Authentication error: Invalid token'));
  }

  logger.debug({ socketId: socket.id }, 'Authentication successful');
  next();
});

// ============================================
// SOCKET CONNECTION HANDLING
// ============================================

io.on('connection', (socket: Socket) => {
  const clientId = socket.handshake.query.clientId as string || uuidv4();
  const clientInfo: ClientInfo = {
    socket,
    lastSeen: Date.now(),
    clientId,
    connectedAt: Date.now(),
  };
  clients.set(socket.id, clientInfo);

  logger.info({ clientId, socketId: socket.id, totalClients: clients.size }, 'Client connected');

  // Send current queue state to newly connected client
  socket.emit('queue:sync', messageStore.getStats());

  // Handle reliable messages
  socket.on('message:send', (data: unknown) => {
    // Rate limiting
    if (!checkRateLimit(clientId)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    // Message validation
    if (!validateMessage(data)) {
      socket.emit('error', { message: 'Invalid message format' });
      return;
    }

    const message = data as QueuedMessage;
    logger.debug({ msgId: message.id, clientId }, 'Received message');

    // Add to message store
    messageStore.add(message);

    // Broadcast to all OTHER clients (sender already applied locally)
    socket.broadcast.emit('message:receive', message);

    // Send ACK back to sender
    socket.emit('message:ack', { messageId: message.id });
  });

  // Handle acknowledgements
  socket.on('message:ack', (data: { messageId: string; senderId: string }) => {
    logger.debug({ msgId: data.messageId, senderId: data.senderId }, 'Received ACK');

    // Mark as acknowledged in store
    messageStore.acknowledge(data.messageId);

    // Notify the original sender (if they're connected)
    const targetClient = Array.from(clients.values())
      .find(c => c.clientId === data.senderId);

    if (targetClient) {
      targetClient.socket.emit('message:acked', { messageId: data.messageId });
    }
  });

  // Handle state sync requests
  socket.on('state:sync', (data: { clientId: string; nodes: unknown[] }) => {
    logger.debug({ clientId: data.clientId }, 'State sync request');
    socket.broadcast.emit('state:update', {
      clientId: data.clientId,
      nodes: data.nodes,
      timestamp: Date.now(),
    });
  });

  // Handle heartbeat
  socket.on('ping', () => {
    clientInfo.lastSeen = Date.now();
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    logger.info({ clientId, socketId: socket.id, reason, totalClients: clients.size - 1 }, 'Client disconnected');
    clients.delete(socket.id);
  });

  // Handle errors
  socket.on('error', (error) => {
    logger.error({ clientId, socketId: socket.id, error: error.message }, 'Socket error');
  });
});

// ============================================
// BACKGROUND LOOPS
// ============================================

const ACK_TIMEOUT_MS = 300;
const CLEANUP_DELAY_MS = 5000;

// Retry loop - resend unacknowledged messages
setInterval(() => {
  const toRetry = messageStore.getPendingForRetry(ACK_TIMEOUT_MS);

  toRetry.forEach((message) => {
    messageStore.incrementAttempts(message.id);

    // Broadcast retry to all clients
    io.emit('message:receive', message);

    if (message.attempts > 3) {
      logger.warn({ msgId: message.id, attempts: message.attempts }, 'Message retry warning');
    }

    if (message.attempts >= message.maxAttempts) {
      logger.error({ msgId: message.id, attempts: message.attempts }, 'Message failed after max attempts');
    }
  });
}, ACK_TIMEOUT_MS);

// Cleanup loop - remove old delivered messages
setInterval(() => {
  const removed = messageStore.cleanup(CLEANUP_DELAY_MS);
  if (removed > 0) {
    logger.debug({ count: removed }, 'Cleaned up delivered messages');
  }
}, CLEANUP_DELAY_MS);

// ============================================
// SERVER STARTUP
// ============================================

httpServer.listen(PORT, () => {
  logger.info({
    port: PORT,
    environment: NODE_ENV,
    healthUrl: `http://localhost:${PORT}/health`,
    metricsUrl: `http://localhost:${PORT}/metrics`,
  }, 'NexusFlow Gatekeeper WebSocket Server started');
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down server...');

  // Close all client connections
  for (const [socketId, client] of clients) {
    client.socket.disconnect(true);
  }
  clients.clear();

  // Close HTTP server
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  logger.info('Server shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  process.exit(1);
});
