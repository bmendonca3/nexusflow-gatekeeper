import React, { useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  NodeProps,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useNexusStore, NodeState } from './store';
import { useChaosConfig } from './chaosConfig';
import { Shield, AlertTriangle, Activity, Zap, Settings, BarChart3 } from 'lucide-react';
import MetricsDashboard from './components/MetricsDashboard';
import { logger } from './utils/logger';
import './App.css';

// Custom node component for robotic nodes
const RoboticNodeComponent: React.FC<NodeProps> = ({ data, id }) => {
  const isEmergency = data.state === 'emergency';
  const isWarning = data.state === 'warning';

  return (
    <div className={`robotic-node ${data.state}`} data-testid={`node-${id}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        {isEmergency ? (
          <AlertTriangle size={16} className="node-icon emergency" />
        ) : isWarning ? (
          <Activity size={16} className="node-icon warning" />
        ) : (
          <Shield size={16} className="node-icon normal" />
        )}
        <span className="node-label">{data.label}</span>
      </div>
      <div className="node-status">
        <span className={`status-indicator ${data.state}`} />
        <span className="status-text">{data.state.toUpperCase()}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

const nodeTypes = {
  robotic: RoboticNodeComponent,
};

// Custom node types for React Flow
const initialNodes: Node[] = [
  {
    id: 'robot-alpha',
    type: 'robotic',
    position: { x: 100, y: 100 },
    data: { label: 'Robot-Alpha', state: 'normal' },
  },
  {
    id: 'robot-beta',
    type: 'robotic',
    position: { x: 400, y: 100 },
    data: { label: 'Robot-Beta', state: 'normal' },
  },
  {
    id: 'robot-gamma',
    type: 'robotic',
    position: { x: 700, y: 100 },
    data: { label: 'Robot-Gamma', state: 'normal' },
  },
  {
    id: 'robot-delta',
    type: 'robotic',
    position: { x: 250, y: 300 },
    data: { label: 'Robot-Delta', state: 'normal' },
  },
  {
    id: 'robot-epsilon',
    type: 'robotic',
    position: { x: 550, y: 300 },
    data: { label: 'Robot-Epsilon', state: 'normal' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: 'robot-alpha', target: 'robot-beta', animated: true },
  { id: 'e2-3', source: 'robot-beta', target: 'robot-gamma', animated: true },
  { id: 'e1-4', source: 'robot-alpha', target: 'robot-delta', animated: true },
  { id: 'e2-5', source: 'robot-beta', target: 'robot-epsilon', animated: true },
];

// Predefined path for Robot-Alpha
const robotAlphaPath = [
  { x: 100, y: 100 },
  { x: 150, y: 150 },
  { x: 200, y: 200 },
  { x: 250, y: 150 },
  { x: 200, y: 100 },
  { x: 150, y: 100 },
];

// Channel for receiving messages (sending is handled by store's ACK loop)
// Lazy initialization to work with test mocks
let _appChannel: BroadcastChannel | null = null;
function getAppChannel(): BroadcastChannel {
  if (!_appChannel) {
    _appChannel = new BroadcastChannel('nexusflow-sync');
  }
  return _appChannel;
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { nodes: storeNodes, setNodeState } = useNexusStore();
  const initialized = useRef(false);

  // Sync store with React Flow nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const storeNode = storeNodes.find((n) => n.id === node.id);
        if (storeNode) {
          return {
            ...node,
            position: storeNode.position,
            data: { ...node.data, state: storeNode.state },
          };
        }
        return node;
      })
    );
  }, [storeNodes, setNodes]);

  // Listen for BroadcastChannel messages (cross-tab sync)
  // PHASE 3: Now receives ReliableMessage format with ACK loop
  // FIX: Use handleReliableMessage which updates state WITHOUT re-broadcasting
  // Previously, setNodeState was called here which caused an infinite message loop
  const { handleReliableMessage, acknowledgeMessage } = useNexusStore();

  useEffect(() => {
    const appChannel = getAppChannel();
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      // Use handleReliableMessage to update state WITHOUT re-broadcasting
      // This prevents the infinite echo loop that occurred when setNodeState was used
      const handled = handleReliableMessage(message);

      // Send acknowledgement if message was handled and wasn't an ACK itself
      if (handled && message.type !== 'ACKNOWLEDGEMENT') {
        acknowledgeMessage(message.id);
      }

      // Log for debugging
      if (message.type === 'NODE_STATE_CHANGE') {
        logger.debug({ nodeId: message.payload.nodeId, state: message.payload.state, msgId: message.id }, 'Received NODE_STATE_CHANGE');
      } else if (message.type === 'STATE_SYNC') {
        logger.debug({ nodeCount: message.payload?.length || 0 }, 'Received STATE_SYNC');
      } else if (message.type === 'ACKNOWLEDGEMENT') {
        logger.debug({ msgId: message.payload.messageId }, 'Received ACKNOWLEDGEMENT');
      }
    };
    appChannel.addEventListener('message', handleMessage);
    return () => appChannel.removeEventListener('message', handleMessage);
  }, [handleReliableMessage, acknowledgeMessage]);

  // Robot-Alpha movement animation
  useEffect(() => {
    let pathIndex = 0;
    const interval = setInterval(() => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === 'robot-alpha') {
            const newPos = robotAlphaPath[pathIndex];
            pathIndex = (pathIndex + 1) % robotAlphaPath.length;
            return { ...node, position: newPos };
          }
          return node;
        })
      );
    }, 500);

    return () => clearInterval(interval);
  }, [setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const changeNodeState = (nodeId: string, state: NodeState) => {
    // PHASE 3: THE HEALER PROTOCOL
    // setNodeState now uses the ACK Loop with automatic retry
    // No manual broadcasting needed - the store handles reliable messaging
    setNodeState(nodeId, state);
    logger.info({ nodeId, state }, 'Initiating state change with ACK loop');
  };

  const chaosConfig = useChaosConfig();
  const [showChaosPanel, setShowChaosPanel] = React.useState(false);

  return (
    <div className="app-container">
      <div className="header">
        <div className="header-left">
          <h1>NexusFlow Gatekeeper</h1>
          <p>Cyber-Physical Digital Twin Dashboard</p>
        </div>
        <div className="header-right">
          {/* Chaos Mode Toggle */}
          <button
            className={`chaos-toggle ${chaosConfig.chaosEnabled ? 'active' : ''}`}
            onClick={() => chaosConfig.setChaosEnabled(!chaosConfig.chaosEnabled)}
            title="Toggle Chaos Mode"
          >
            <Zap size={16} />
            <span>Chaos {chaosConfig.chaosEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Metrics Toggle */}
          <MetricsDashboard />
        </div>
      </div>

      {/* Chaos Control Panel */}
      {showChaosPanel && (
        <div className="chaos-panel">
          <div className="chaos-panel-header">
            <h3><Zap size={16} /> Chaos Configuration</h3>
            <button className="chaos-panel-close" onClick={() => setShowChaosPanel(false)}>×</button>
          </div>

          <div className="chaos-controls">
            <div className="chaos-control">
              <label>
                Block Rate: {chaosConfig.blockRate}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={chaosConfig.blockRate}
                  onChange={(e) => chaosConfig.setBlockRate(parseInt(e.target.value))}
                  disabled={!chaosConfig.chaosEnabled}
                />
              </label>
            </div>

            <div className="chaos-control">
              <label>
                Latency: {chaosConfig.latencyMs}ms
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="50"
                  value={chaosConfig.latencyMs}
                  onChange={(e) => chaosConfig.setLatencyMs(parseInt(e.target.value))}
                  disabled={!chaosConfig.chaosEnabled}
                />
              </label>
            </div>

            <div className="chaos-control">
              <label>
                Error Rate: {chaosConfig.errorRate}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={chaosConfig.errorRate}
                  onChange={(e) => chaosConfig.setErrorRate(parseInt(e.target.value))}
                  disabled={!chaosConfig.chaosEnabled}
                />
              </label>
            </div>

            <button
              className="chaos-reset"
              onClick={() => chaosConfig.reset()}
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}

      <div className="controls" role="group" aria-label="Robot Control Panel">
        <button
          className="control-btn emergency"
          onClick={() => changeNodeState('robot-alpha', 'emergency')}
          aria-label="Set Robot-Alpha to Emergency State"
          aria-pressed="false"
        >
          Set Robot-Alpha EMERGENCY
        </button>
        <button
          className="control-btn normal"
          onClick={() => changeNodeState('robot-alpha', 'normal')}
          aria-label="Set Robot-Alpha to Normal State"
          aria-pressed="true"
        >
          Set Robot-Alpha NORMAL
        </button>
        <button
          className="control-btn chaos"
          onClick={() => setShowChaosPanel(!showChaosPanel)}
          title="Configure Chaos Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
