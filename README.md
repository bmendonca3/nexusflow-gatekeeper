# NexusFlow Gatekeeper

A production-grade Cyber-Physical Digital Twin dashboard implementing the **Healer Protocol** for reliable distributed state synchronization.

## Features

- **Healer Protocol**: Reliable messaging with ACK loop, automatic retry, and duplicate detection
- **Dual Transport**: BroadcastChannel (development) and WebSocket (production)
- **Chaos Engineering**: Built-in packet loss and latency simulation
- **Production Ready**: Structured logging, rate limiting, message validation, graceful shutdown

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Run development server
npm run dev
```

Visit `http://localhost:3000`

## Architecture

```
┌─────────────────────────────────────────┐
│           NexusFlow Gatekeeper           │
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │          Zustand Store             │  │
│  │  - Nodes    - Metrics  - Chaos    │  │
│  └───────────────────────────────────┘  │
│                   │                     │
│           Healer Protocol               │
│  ┌─────────────────────────────┐        │
│  │ ACK Loop │ Retry │ Cleanup │        │
│  └─────────────────────────────┘        │
│                   │                     │
│         Transport Layer                 │
│  ┌─────────────────────────────┐        │
│  │ BroadcastChannel │ WebSocket │        │
│  └─────────────────────────────┘        │
└─────────────────────────────────────────┘
```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXUS_SECRET` | Yes | Server authentication secret |
| `VITE_NEXUS_TOKEN` | Yes | Client authentication token |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment mode |

## Security

- Token-based WebSocket authentication
- Rate limiting (100 msgs/sec per client)
- Message validation with UUID format check
- Startup fails without configured secrets

## Testing

```bash
# Run all tests
npm test
```

## Deployment

### Docker

```bash
# Build image
docker build -t nexusflow-gatekeeper .

# Run container
docker run -p 3000:3000 -p 3001:3001 \
  -e NEXUS_SECRET=your-secret \
  -e VITE_NEXUS_TOKEN=your-token \
  nexusflow-gatekeeper
```

### Production Checklist

- [ ] Set strong `NEXUS_SECRET` (32+ characters)
- [ ] Set strong `VITE_NEXUS_TOKEN`
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Set `NODE_ENV=production`
- [ ] Configure reverse proxy with SSL/TLS

## Project Structure

```
nexusflow-gatekeeper/
├── src/
│   ├── store.ts           # Main store with Healer Protocol
│   ├── App.tsx            # Dashboard component
│   ├── transport/         # Transport layer
│   ├── components/        # React components
│   └── utils/             # Utilities (logger, etc.)
├── server/                # WebSocket server
├── tests/                 # E2E tests
├── Dockerfile            # Container configuration
└── README.md             # This file
```

## License

ISC
