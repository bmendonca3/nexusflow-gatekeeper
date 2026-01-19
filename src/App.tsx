import React, { useEffect, useCallback } from 'react';
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
import { Shield, AlertTriangle, Activity, Zap } from 'lucide-react';
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

// Channel for receiving messages (sending is handled by store's ACK loop)
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
  const { handleReliableMessage, acknowledgeMessage } = useNexusStore();

  useEffect(() => {
    const appChannel = getAppChannel();
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      const handled = handleReliableMessage(message);
      if (handled && message.type !== 'ACKNOWLEDGEMENT') {
        acknowledgeMessage(message.id);
      }
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
            const newPos = [
              { x: 100, y: 100 },
              { x: 150, y: 150 },
              { x: 200, y: 200 },
              { x: 250, y: 150 },
              { x: 200, y: 100 },
              { x: 150, y: 100 },
            ][pathIndex];
            pathIndex = (pathIndex + 1) % 6;
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
          <button
            className={`chaos-toggle ${chaosConfig.chaosEnabled ? 'active' : ''}`}
            onClick={() => chaosConfig.setChaosEnabled(!chaosConfig.chaosEnabled)}
            title="Toggle Chaos Mode"
          >
            <Zap size={16} />
            <span>Chaos {chaosConfig.chaosEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <MetricsDashboard />
        </div>
      </div>

      {showChaosPanel && (
        <div className="chaos-panel">
          <div className="chaos-panel-header">
            <h3><Zap size={16} /> Chaos Configuration</h3>
            <button className="chaos-panel-close" onClick={() => setShowChaosPanel(false)}>×</button>
          </div>
          <button
            className="chaos-reset"
            onClick={() => chaosConfig.reset()}
          >
            Reset to Defaults
          </button>
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