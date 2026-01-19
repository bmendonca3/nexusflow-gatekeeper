/**
 * Chaos Mode Configuration
 * Global state for chaos/injection settings
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChaosConfig {
  // Fault injection settings
  blockRate: number; // 0-100, percentage of messages to block
  latencyMs: number; // Artificial latency to add (ms)
  errorRate: number; // 0-100, percentage of errors to inject

  // Feature toggles
  chaosEnabled: boolean;
  showMetrics: boolean;
  verboseLogging: boolean;

  // Actions
  setBlockRate: (rate: number) => void;
  setLatencyMs: (latency: number) => void;
  setErrorRate: (rate: number) => void;
  setChaosEnabled: (enabled: boolean) => void;
  setShowMetrics: (show: boolean) => void;
  setVerboseLogging: (enabled: boolean) => void;
  reset: () => void;
}

const defaultConfig = {
  blockRate: 50,
  latencyMs: 0,
  errorRate: 0,
  chaosEnabled: false,
  showMetrics: true,
  verboseLogging: false,
};

export const useChaosConfig = create<ChaosConfig>()(
  persist(
    (set) => ({
      ...defaultConfig,

      setBlockRate: (blockRate) => set({ blockRate: Math.min(100, Math.max(0, blockRate)) }),
      setLatencyMs: (latencyMs) => set({ latencyMs: Math.max(0, latencyMs) }),
      setErrorRate: (errorRate) => set({ errorRate: Math.min(100, Math.max(0, errorRate)) }),
      setChaosEnabled: (chaosEnabled) => set({ chaosEnabled }),
      setShowMetrics: (showMetrics) => set({ showMetrics }),
      setVerboseLogging: (verboseLogging) => set({ verboseLogging }),
      reset: () => set(defaultConfig),
    }),
    {
      name: 'nexusflow-chaos-config',
    }
  )
);

// Global access for tests (bypasses React hooks)
let _chaosConfig = { ...defaultConfig };

export function getChaosConfig() {
  return _chaosConfig;
}

export function shouldBlockMessage(): boolean {
  if (!_chaosConfig.chaosEnabled) return false;
  return Math.random() * 100 < _chaosConfig.blockRate;
}

export function getArtificialLatency(): number {
  if (!_chaosConfig.chaosEnabled) return 0;
  return _chaosConfig.latencyMs;
}

export function shouldInjectError(): boolean {
  if (!_chaosConfig.chaosEnabled) return false;
  return Math.random() * 100 < _chaosConfig.errorRate;
}

// Subscribe to store changes to keep global in sync
if (typeof window !== 'undefined') {
  useChaosConfig.subscribe((state) => {
    _chaosConfig = {
      blockRate: state.blockRate,
      latencyMs: state.latencyMs,
      errorRate: state.errorRate,
      chaosEnabled: state.chaosEnabled,
      showMetrics: state.showMetrics,
      verboseLogging: state.verboseLogging,
    };
  });
}
