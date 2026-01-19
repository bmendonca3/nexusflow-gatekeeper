/**
 * Metrics Dashboard Component
 * Displays real-time metrics for the NexusFlow sync system
 */

import React, { useState, useEffect, useRef } from 'react';
import { Activity, Clock, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useNexusStore, getTransportType } from '../store';

export const MetricsDashboard: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  // Select metrics directly from store
  const { metrics, pendingMessages, chaosConfig, setChaosConfig } = useNexusStore();

  // Local state for visualization (Latency Chart)
  // We use a ref for high-frequency updates, but sync to state for rendering to avoid Ref-in-Render violations
  const latenciesRef = useRef<number[]>([]);
  const [visibleLatencies, setVisibleLatencies] = useState<number[]>([]);

  // Listen for latency updates to populate chart
  useEffect(() => {
    if (metrics.lastLatency > 0) {
      latenciesRef.current.push(metrics.lastLatency);
      // Keep only last 50 latencies
      if (latenciesRef.current.length > 50) {
        latenciesRef.current.shift();
      }
      // Update visualization state (throttled/batched by React)
      setVisibleLatencies([...latenciesRef.current]);
    }
  }, [metrics.lastLatency]);

  const ackRate = metrics.messagesSent > 0
    ? Math.round((metrics.acksReceived / metrics.messagesSent) * 100)
    : 0;

  const transportType = getTransportType();
  const syncSuccess = metrics.messagesReceived > 0;

  // Average for display
  const avgLatency = visibleLatencies.length > 0
    ? Math.round(visibleLatencies.reduce((a, b) => a + b, 0) / visibleLatencies.length)
    : 0;

  if (!isOpen) {
    return (
      <button
        className="metrics-toggle"
        onClick={() => setIsOpen(true)}
        title="Open Metrics Dashboard"
      >
        <Activity size={20} />
        <span className="metrics-badge">{metrics.messagesSent}</span>
      </button>
    );
  }

  return (
    <div className="metrics-dashboard">
      <div className="metrics-header">
        <h3>
          <Activity size={16} />
          NexusFlow Metrics
        </h3>
        <button className="metrics-close" onClick={() => setIsOpen(false)}>
          ×
        </button>
      </div>

      <div className="metrics-grid">
        {/* Messages Sent */}
        <div className="metric-card">
          <div className="metric-icon sent">
            <RefreshCw size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{metrics.messagesSent}</span>
            <span className="metric-label">Messages Sent</span>
          </div>
        </div>

        {/* Messages Received */}
        <div className="metric-card">
          <div className="metric-icon received">
            <CheckCircle size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{metrics.messagesReceived}</span>
            <span className="metric-label">Messages Received</span>
          </div>
        </div>

        {/* ACK Rate */}
        <div className="metric-card">
          <div className={`metric-icon ${ackRate >= 90 ? 'success' : ackRate >= 70 ? 'warning' : 'error'}`}>
            <Activity size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{ackRate}%</span>
            <span className="metric-label">ACK Rate</span>
          </div>
        </div>

        {/* Retries */}
        <div className="metric-card">
          <div className={`metric-icon ${metrics.retries === 0 ? 'success' : 'warning'}`}>
            <RefreshCw size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{metrics.retries}</span>
            <span className="metric-label">Retries</span>
          </div>
        </div>

        {/* Average Latency */}
        <div className="metric-card">
          <div className={`metric-icon ${avgLatency < 500 ? 'success' : avgLatency < 1000 ? 'warning' : 'error'}`}>
            <Clock size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{avgLatency}ms</span>
            <span className="metric-label">Avg Latency</span>
          </div>
        </div>

        {/* Pending Messages */}
        <div className="metric-card">
          <div className={`metric-icon ${pendingMessages.size === 0 ? 'success' : 'warning'}`}>
            <AlertCircle size={16} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{pendingMessages.size}</span>
            <span className="metric-label">Pending</span>
          </div>
        </div>
      </div>

      {/* Latency Bar Chart */}
      <div className="latency-chart">
        <h4>Latency Distribution</h4>
        <div className="bar-chart">
          {visibleLatencies.slice(-20).map((latency, idx) => (
            <div
              key={idx}
              className={`bar ${latency < 500 ? 'success' : latency < 1000 ? 'warning' : 'error'}`}
              style={{ height: `${Math.min(100, (latency / 2000) * 100)}%` }}
              title={`${latency}ms`}
            />
          ))}
          {visibleLatencies.length === 0 && (
            <div className="no-data">No latency data yet</div>
          )}
        </div>
        <div className="chart-labels">
          <span>0ms</span>
          <span>1000ms</span>
          <span>2000ms</span>
        </div>
      </div>

      {/* Chaos Controls */}
      <div className="chaos-controls">
        <h4>Chaos Engineering</h4>
        <div className="chaos-grid">
          <div className="chaos-item">
            <label>Packet Loss: {Math.round(chaosConfig.packetLossRate * 100)}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={chaosConfig.packetLossRate * 100}
              onChange={(e) => setChaosConfig({ packetLossRate: parseInt(e.target.value) / 100 })}
            />
          </div>
          <div className="chaos-item">
            <label>Latency (ms)</label>
            <div className="latency-inputs">
              <input
                type="number"
                placeholder="Min"
                value={chaosConfig.minLatency}
                onChange={(e) => setChaosConfig({ minLatency: parseInt(e.target.value) || 0 })}
              />
              <span>-</span>
              <input
                type="number"
                placeholder="Max"
                value={chaosConfig.maxLatency}
                onChange={(e) => setChaosConfig({ maxLatency: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Transport Info */}
      <div className="metrics-footer">
        <span className="transport-info">
          Transport: <strong>{transportType}</strong>
        </span>
        <span className="sync-status">
          {syncSuccess ? (
            <span className="status-success">
              <CheckCircle size={14} /> Sync Active
            </span>
          ) : (
            <span className="status-idle">
              <AlertCircle size={14} /> Awaiting Sync
            </span>
          )}
        </span>
      </div>

      {/* Vector Clock Debug */}
      <div className="vector-clock-debug" style={{ fontSize: '10px', marginTop: '8px', color: '#666', fontFamily: 'monospace' }}>
        Store Integration: Active
      </div>
    </div>
  );
};

export default MetricsDashboard;
