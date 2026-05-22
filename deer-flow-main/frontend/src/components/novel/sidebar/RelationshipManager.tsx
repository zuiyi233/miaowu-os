'use client';

import { Network, Plus, Trash2 } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface RelationshipNode {
  id: string;
  name: string;
  type: string;
}

interface RelationshipEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

interface RelationshipManagerProps {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  onAddRelationship?: () => void;
  onDeleteRelationship?: (id: string) => void;
}

export const RelationshipManager: React.FC<RelationshipManagerProps> = ({
  nodes,
  edges,
  onAddRelationship,
  onDeleteRelationship,
}) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Network className="h-4 w-4" />
          关系管理
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{edges.length} 个关系</Badge>
          {onAddRelationship && (
            <Button size="sm" variant="outline" onClick={onAddRelationship}>
              <Plus className="h-3 w-3 mr-1" />
              添加关系
            </Button>
          )}
        </div>

        <ScrollArea className="h-[150px]">
          <div className="space-y-2">
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              return (
                <div
                  key={edge.id}
                  className="flex items-center justify-between p-2 rounded-md border text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{fromNode?.name || '未知'}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className="text-[10px]">{toNode?.name || '未知'}</Badge>
                    <span className="text-muted-foreground/70">{edge.label}</span>
                  </div>
                  {onDeleteRelationship && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => onDeleteRelationship(edge.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
