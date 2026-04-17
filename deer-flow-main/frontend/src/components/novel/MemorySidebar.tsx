'use client';

import { useMemo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Flame, Star, Zap, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { MemoryAnnotation, MemoryAnnotationType } from '@/core/novel/schemas';

interface MemorySidebarProps {
  annotations: MemoryAnnotation[];
  activeAnnotationId?: string;
  onAnnotationClick?: (annotation: MemoryAnnotation) => void;
  scrollToAnnotation?: string;
}

const TYPE_CONFIG: Record<MemoryAnnotationType, { label: string; icon: typeof Flame; color: string; borderColor: string; bgColor: string }> = {
  hook: { label: '钩子', icon: Flame, color: 'text-red-500', borderColor: 'border-l-red-500', bgColor: 'hover:bg-red-50' },
  foreshadow: { label: '伏笔', icon: Star, color: 'text-blue-500', borderColor: 'border-l-blue-500', bgColor: 'hover:bg-blue-50' },
  plot_point: { label: '情节点', icon: Zap, color: 'text-green-500', borderColor: 'border-l-green-500', bgColor: 'hover:bg-green-50' },
  character_event: { label: '角色事件', icon: User, color: 'text-yellow-500', borderColor: 'border-l-yellow-500', bgColor: 'hover:bg-yellow-50' },
};

export function MemorySidebar({
  annotations = [],
  activeAnnotationId,
  onAnnotationClick,
  scrollToAnnotation,
}: MemorySidebarProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (scrollToAnnotation && cardRefs.current[scrollToAnnotation]) {
      cardRefs.current[scrollToAnnotation]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [scrollToAnnotation]);

  const groupedAnnotations = useMemo(() => {
    const groups: Record<MemoryAnnotationType, MemoryAnnotation[]> = {
      hook: [], foreshadow: [], plot_point: [], character_event: [],
    };
    annotations.forEach((a) => { if (groups[a.type]) groups[a.type].push(a); });
    Object.values(groups).forEach((arr) => arr.sort((a, b) => b.importance - a.importance));
    return groups;
  }, [annotations]);

  const stats = useMemo(() => ({
    total: annotations.length,
    hooks: groupedAnnotations.hook.length,
    foreshadows: groupedAnnotations.foreshadow.length,
    plotPoints: groupedAnnotations.plot_point.length,
    characterEvents: groupedAnnotations.character_event.length,
  }), [annotations, groupedAnnotations]);

  if (annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">暂无分析数据</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full p-4">
      {/* Stats Overview */}
      <Card className="mb-4 p-4">
        <p className="text-sm font-semibold mb-3">📊 分析概览</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '钩子', value: stats.hooks, type: 'hook' as MemoryAnnotationType },
            { label: '伏笔', value: stats.foreshadows, type: 'foreshadow' as MemoryAnnotationType },
            { label: '情节点', value: stats.plotPoints, type: 'plot_point' as MemoryAnnotationType },
            { label: '角色事件', value: stats.characterEvents, type: 'character_event' as MemoryAnnotationType },
          ].map(({ label, value, type }) => {
            const config = TYPE_CONFIG[type];
            return (
              <div key={type}>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-bold", config.color)}>{value}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Separator className="my-4" />

      {/* Grouped Annotations */}
      <div className="space-y-2">
        {(Object.entries(TYPE_CONFIG) as [MemoryAnnotationType, typeof TYPE_CONFIG[MemoryAnnotationType]][]).map(
          ([type, config]) => {
            const items = groupedAnnotations[type];
            if (!items.length) return null;
            const Icon = config.icon;

            return (
              <Collapsible key={type} defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent transition-colors">
                  <Icon className={cn("h-3.5 w-3.5", config.color)} />
                  <span>{config.label}</span>
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{items.length}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-1 pl-1">
                  {items.map((annotation) => {
                    const isActive = activeAnnotationId === annotation.id;
                    return (
                      <div
                        key={annotation.id}
                        ref={(el) => { cardRefs.current[annotation.id] = el; }}
                        onClick={() => onAnnotationClick?.(annotation)}
                        className={cn(
                          "cursor-pointer rounded-md border-l-4 p-3 transition-all",
                          config.borderColor,
                          isActive ? 'bg-accent' : config.bgColor,
                        )}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <p className="text-sm font-medium leading-snug pr-2 line-clamp-1">
                            <Icon className={cn("inline h-3.5 w-3.5 mr-1 align-text-bottom", config.color)} />
                            {annotation.title}
                          </p>
                          <Badge variant="secondary" className="shrink-0 text-[11px]">
                            {(annotation.importance * 10).toFixed(1)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          {annotation.content.length > 100 ? `${annotation.content.slice(0, 100)}...` : annotation.content}
                        </p>
                        {annotation.tags && annotation.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {annotation.tags.map((tag, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">{tag}</Badge>
                            ))}
                          </div>
                        )}
                        {(annotation.metadata.strength || annotation.metadata.foreshadowType) && (
                          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                            {annotation.metadata.strength != null && <span>强度: {annotation.metadata.strength}/10</span>}
                            {annotation.metadata.foreshadowType && (
                              <Badge variant="outline" className="text-[10px] py-0">
                                {annotation.metadata.foreshadowType === 'planted' ? '已埋下' : '已回收'}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          }
        )}
      </div>
    </ScrollArea>
  );
}
