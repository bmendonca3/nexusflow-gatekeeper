/**
 * Vector Clock Implementation
 *
 * A logical clock mechanism for capturing causality in distributed systems.
 * Each client maintains a vector of counters, one for each known client.
 *
 * Vector clocks allow us to:
 * 1. Determine the partial ordering of events
 * 2. Detect concurrent updates
 * 3. Resolve conflicts in a CRDT-like manner
 */

// Client ID -> counter mapping
export type VectorClock = Record<string, number>;

// Vector clock with metadata
export interface VectorClockEntry {
  clock: VectorClock;
  clientId: string;
  timestamp: number;
}

/**
 * Create an initial vector clock for a new client
 */
export function createVectorClock(clientId: string): VectorClock {
  return { [clientId]: 0 };
}

/**
 * Increment the local client's counter in the vector clock
 */
export function incrementClock(clock: VectorClock, clientId: string): VectorClock {
  return {
    ...clock,
    [clientId]: (clock[clientId] || 0) + 1,
  };
}

/**
 * Merge two vector clocks (for receiving updates from other clients)
 * Implements the "max" operation for each counter
 */
export function mergeClocks(local: VectorClock, remote: VectorClock): VectorClock {
  const merged = { ...local };

  // Get all client IDs from both clocks
  const clientIds = new Set([...Object.keys(local), ...Object.keys(remote)]);

  clientIds.forEach((clientId) => {
    const localCounter = local[clientId] || 0;
    const remoteCounter = remote[clientId] || 0;
    merged[clientId] = Math.max(localCounter, remoteCounter);
  });

  return merged;
}

/**
 * Compare two vector clocks
 * Returns:
 *  - 'equal': clocks are identical
 *  - 'greater': clockA is greater than clockB (A happened after B)
 *  - 'less': clockA is less than clockB (A happened before B)
 *  - 'concurrent': clocks are concurrent (neither happened before the other)
 */
export type ClockComparison = 'equal' | 'greater' | 'less' | 'concurrent';

export function compareClocks(clockA: VectorClock, clockB: VectorClock): ClockComparison {
  const clientIds = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);
  let aGreater = false;
  let bGreater = false;

  clientIds.forEach((clientId) => {
    const a = clockA[clientId] || 0;
    const b = clockB[clientId] || 0;

    if (a > b) aGreater = true;
    if (b > a) bGreater = true;
  });

  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 'greater';
  if (bGreater) return 'less';
  return 'equal';
}

/**
 * Check if clockA happened before clockB
 */
export function happenedBefore(clockA: VectorClock, clockB: VectorClock): boolean {
  const clientIds = new Set([...Object.keys(clockA), ...Object.keys(clockB)]);

  let atLeastOneLess = false;

  clientIds.forEach((clientId) => {
    const a = clockA[clientId] || 0;
    const b = clockB[clientId] || 0;

    if (a > b) return false; // A cannot have happened before B
    if (a < b) atLeastOneLess = true;
  });

  return atLeastOneLess;
}

/**
 * Get the next logical timestamp for a client
 * Combines vector clock with physical timestamp for display
 */
export function getNextTimestamp(clock: VectorClock, clientId: string): {
  logical: number;
  vector: VectorClock;
  combined: string;
} {
  const newClock = incrementClock(clock, clientId);
  const logical = newClock[clientId];
  const combined = `${Date.now()}-${logical}`;

  return {
    logical,
    vector: newClock,
    combined,
  };
}

/**
 * Serialize vector clock for storage/transmission
 */
export function serializeClock(clock: VectorClock): string {
  return JSON.stringify(clock);
}

/**
 * Deserialize vector clock from storage/transmission
 */
export function deserializeClock(data: string): VectorClock {
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Get a human-readable representation of the vector clock
 */
export function formatClock(clock: VectorClock): string {
  const entries = Object.entries(clock)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `${id.split('-')[0] || id}:${count}`)
    .join(' ');

  return `[${entries}]`;
}

/**
 * Find the maximum counter across all clients in the clock
 */
export function getMaxCounter(clock: VectorClock): number {
  return Math.max(...Object.values(clock));
}

/**
 * Check if a vector clock is valid (all values are non-negative integers)
 */
export function isValidClock(clock: VectorClock): boolean {
  return Object.values(clock).every(
    (value) => typeof value === 'number' && value >= 0 && Number.isInteger(value)
  );
}

/**
 * Remove a client from the vector clock (for cleanup)
 */
export function removeClient(clock: VectorClock, clientId: string): VectorClock {
  const { [clientId]: _, ...rest } = clock;
  return rest;
}
