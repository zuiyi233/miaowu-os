'use client';

import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Panel,
} from '@xyflow/react';
import type { Node, Edge, Connection } from '@xyflow/react';
import { Plus, Save, User, MapPin, Shield, Gem } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import '@xyflow/react/dist/style.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNovelQuery, useRelationshipsQuery, useAddRelationshipMutation, useGraphLayoutQuery, useSaveGraphLayoutMutation } from '@/core/novel/queries';
import type { EntityRelationship, GraphLayout } from '@/core/novel/schemas';

const ENTITY_COLORS: Record<string, string> = {
  character: '#3b82f6',
  setting: '#22c55e',
  faction: '#ef4444',
  item: '#a855f7',
};

const RELATIONSHIP_COLORS: Record<string, string> = {
  friend: '#22c55e',
  enemy: '#ef4444',
  family: '#f59e0b',
  lover: '#ec4899',
  custom: '#6b7280',
};

function getNodeIcon(type: string) {
  switch (type) {
    case 'character': return <User className="h-4 w-4" />;
    case 'setting': return <MapPin className="h-4 w-4" />;
    case 'faction': return <Shield className="h-4 w-4" />;
    case 'item': return <Gem className="h-4 w-4" />;
    default: return null;
  }
}

function CustomNode({ data }: { data: { label: string; type: string; description?: string } }) {
  const color = ENTITY_COLORS[data.type] || '#6b7280';
  return (
    <Card className="min-w-[150px] border-2" style={{ borderColor: color }}>
      <CardContent className="p-3 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          {getNodeIcon(data.type)}
          <span className="font-medium text-sm">{data.label}</span>
        </div>
        <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
          {data.type}
        </Badge>
      </CardContent>
    </Card>
  );
}

const nodeTypes = { custom: CustomNode };

interface RelationshipGraphProps {
  novelId: string;
}

export function RelationshipGraph({ novelId }: RelationshipGraphProps) {
  const { data: novel } = useNovelQuery(novelId);
  const { data: relationships } = useRelationshipsQuery(novelId);
  const { data: savedLayout } = useGraphLayoutQuery(novelId);
  const saveLayout = useSaveGraphLayoutMutation();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relType, setRelType] = useState<EntityRelationship['type']>('friend');
  const [relDescription, setRelDescription] = useState('');
  const [hasLayoutChanges, setHasLayoutChanges] = useState(false);

  const addRelationship = useAddRelationshipMutation(novelId);

  const handleNodeDragStop = useCallback((_event: any, node: Node) => {
    setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: node.position } : n)));
    setHasLayoutChanges(true);
  }, [setNodes]);

  const handleSaveLayout = useCallback(async () => {
    if (!novelId || nodes.length === 0) return;
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => {
      positions[n.id] = n.position;
    });

    const layout: GraphLayout = {
      id: `layout-${novelId}`,
      novelId,
      nodePositions: positions,
      isLocked: false,
      lastUpdated: new Date(),
    };

    await saveLayout.mutateAsync(layout);
    setHasLayoutChanges(false);
  }, [novelId, nodes, saveLayout]);

  useEffect(() => {
    if (!novel) return;

    const allEntities = [
      ...(novel.characters || []).map((c) => ({ ...c, entityType: 'character' as const })),
      ...(novel.settings || []).map((s) => ({ ...s, entityType: 'setting' as const })),
      ...(novel.factions || []).map((f) => ({ ...f, entityType: 'faction' as const })),
      ...(novel.items || []).map((i) => ({ ...i, entityType: 'item' as const })),
    ];

    const savedPositions = savedLayout?.nodePositions || {};

    const nodeData: Node[] = allEntities.map((entity, index) => {
      const savedPos = savedPositions[entity.id];
      if (savedPos) {
        return {
          id: entity.id,
          type: 'custom',
          position: savedPos,
          data: {
            label: entity.name,
            type: entity.entityType,
            description: entity.description,
          },
        };
      }

      const angle = (index / allEntities.length) * 2 * Math.PI;
      const radius = 300;
      return {
        id: entity.id,
        type: 'custom',
        position: { x: Math.cos(angle) * radius + 400, y: Math.sin(angle) * radius + 300 },
        data: {
          label: entity.name,
          type: entity.entityType,
          description: entity.description,
        },
      };
    });

    setNodes(nodeData);

    const edgeData: Edge[] = (relationships || []).map((rel) => ({
      id: rel.id,
      source: rel.sourceId,
      target: rel.targetId,
      label: rel.description || rel.type,
      style: { stroke: RELATIONSHIP_COLORS[rel.type] || '#6b7280', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: RELATIONSHIP_COLORS[rel.type] || '#6b7280' },
    }));

    setEdges(edgeData);
  }, [novel, relationships, savedLayout]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleAddRelationship = async () => {
    if (!sourceId || !targetId || !novelId) return;
    await addRelationship.mutateAsync({
      id: crypto.randomUUID(),
      sourceId,
      targetId,
      type: relType,
      description: relDescription,
      novelId,
    });
    setShowAddDialog(false);
    setSourceId('');
    setTargetId('');
    setRelType('friend');
    setRelDescription('');
  };

  if (!novel) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const allEntities = [
    ...(novel.characters || []),
    ...(novel.settings || []),
    ...(novel.factions || []),
    ...(novel.items || []),
  ];

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        className="bg-muted/20"
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <div className="bg-background rounded-lg shadow-lg p-2 border">
            <h3 className="text-sm font-medium mb-2">Entity Relationships</h3>
            <Button size="sm" className="gap-1 w-full" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-3 w-3" />
              Add Relationship
            </Button>
          </div>
        </Panel>
        {hasLayoutChanges && (
          <Panel position="top-right">
            <Button size="sm" className="gap-1" onClick={handleSaveLayout} disabled={saveLayout.isPending}>
              <Save className="h-3 w-3" />
              {saveLayout.isPending ? '保存中...' : '保存布局'}
            </Button>
          </Panel>
        )}
        <Panel position="bottom-right">
          <div className="bg-background rounded-lg shadow-lg p-2 border text-xs space-y-1">
            {Object.entries(ENTITY_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="capitalize">{type}</span>
              </div>
            ))}
          </div>
        </Panel>
      </ReactFlow>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
            <DialogDescription>Create a connection between two entities.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Source Entity</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  {allEntities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Entity</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target..." />
                </SelectTrigger>
                <SelectContent>
                  {allEntities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Relationship Type</Label>
              <Select value={relType} onValueChange={(v) => setRelType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="friend">Friend</SelectItem>
                  <SelectItem value="enemy">Enemy</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                  <SelectItem value="lover">Lover</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <input
                type="text"
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
                value={relDescription}
                onChange={(e) => setRelDescription(e.target.value)}
                placeholder="Describe the relationship..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddRelationship} disabled={!sourceId || !targetId}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
