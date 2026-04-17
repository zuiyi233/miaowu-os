'use client';

import { useMemo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface MemoryAnnotation {
  id: string;
  type: 'hook' | 'foreshadow' | 'plot_point' | 'character_event';
  title: string;
  content: string;
  importance: number;
  position: number;
  length: number;
  tags: string[];
  metadata?: {
    strength?: number;
    foreshadowType?: 'planted' | 'resolved';
    relatedCharacters?: string[];
    [key: string]: unknown;
  };
}

interface AnnotatedTextProps {
  content: string;
  annotations: MemoryAnnotation[];
  onAnnotationClick?: (annotation: MemoryAnnotation) => void;
  activeAnnotationId?: string;
  scrollToAnnotation?: string;
  className?: string;
}

const TYPE_STYLES: Record<MemoryAnnotation['type'], { color: string; emoji: string }> = {
  hook: { color: '#ef4444', emoji: '🎣' },
  foreshadow: { color: '#3b82f6', emoji: '🌟' },
  plot_point: { color: '#22c55e', emoji: '💎' },
  character_event: { color: '#f59e0b', emoji: '👤' },
};

interface TextSegment {
  type: 'text' | 'annotated';
  content: string;
  annotation?: MemoryAnnotation;
  annotations?: MemoryAnnotation[];
}

export function AnnotatedText({
  content,
  annotations,
  onAnnotationClick,
  activeAnnotationId,
  scrollToAnnotation,
  className,
}: AnnotatedTextProps) {
  const annotationRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    if (scrollToAnnotation && annotationRefs.current[scrollToAnnotation]) {
      annotationRefs.current[scrollToAnnotation]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [scrollToAnnotation]);

  const processedAnnotations = useMemo(() => {
    if (!annotations?.length) return [];
    return annotations
      .filter((a) => a.position >= 0 && a.position < content.length)
      .sort((a, b) => a.position - b.position);
  }, [annotations, content]);

  const segments = useMemo(() => {
    if (!processedAnnotations.length) return [{ type: 'text' as const, content }];

    const result: TextSegment[] = [];
    let lastPos = 0;

    const ranges: Array<{ start: number; end: number; annotations: MemoryAnnotation[] }> = [];

    for (const ann of processedAnnotations) {
      const start = ann.position;
      const end = ann.position + Math.max(ann.length, 30);
      const overlap = ranges.find(
        (r) =>
          (start >= r.start && start <= r.end) ||
          (end >= r.start && end <= r.end) ||
          (start <= r.start && end >= r.end) ||
          Math.abs(start - r.end) <= 5 ||
          Math.abs(end - r.start) <= 5
      );

      if (overlap) {
        overlap.start = Math.min(overlap.start, start);
        overlap.end = Math.max(overlap.end, end);
        overlap.annotations.push(ann);
      } else {
        ranges.push({ start, end, annotations: [ann] });
      }
    }

    ranges.sort((a, b) => a.start - b.start);

    for (const range of ranges) {
      if (range.start > lastPos) result.push({ type: 'text', content: content.slice(lastPos, range.start) });

      if (range.annotations.length === 1) {
        result.push({
          type: 'annotated',
          content: content.slice(range.start, range.end),
          annotation: range.annotations[0],
          annotations: range.annotations,
        });
      } else {
        const segLen = Math.max(1, Math.floor((range.end - range.start) / range.annotations.length));
        const sorted = [...range.annotations].sort((a, b) => b.importance - a.importance);
        sorted.forEach((ann, i) => {
          const s = range.start + i * segLen;
          const e = i === sorted.length - 1 ? range.end : range.start + (i + 1) * segLen;
          result.push({ type: 'annotated', content: content.slice(s, e), annotation: ann, annotations: sorted });
        });
      }

      lastPos = range.end;
    }

    if (lastPos < content.length) result.push({ type: 'text', content: content.slice(lastPos) });

    return result;
  }, [content, processedAnnotations]);

  const renderSegment = (seg: TextSegment, idx: number) => {
    if (seg.type === 'text') return <span key={idx}>{seg.content}</span>;
    const ann = seg.annotation;
    if (!ann) return null;

    const style = TYPE_STYLES[ann.type];
    const isActive = activeAnnotationId === ann.id;
    const tooltip =
      seg.annotations && seg.annotations.length > 1
        ? `此处有 ${seg.annotations.length} 个标注`
        : `${ann.title}: ${ann.content.slice(0, 100)}${ann.content.length > 100 ? '...' : ''}`;

    return (
      <span
        key={idx}
        ref={(el) => { if (ann) annotationRefs.current[ann.id] = el; }}
        data-annotation-id={ann.id}
        title={tooltip}
        className={cn(
          'inline cursor-pointer transition-all duration-200 px-[2px]',
          isActive && 'bg-opacity-10'
        )}
        style={{
          borderBottom: `2px solid ${style.color}`,
          backgroundColor: isActive ? style.color + '1A' : 'transparent',
          padding: '2px 0',
        }}
        onClick={() => onAnnotationClick?.(ann)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = style.color + '33'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isActive ? style.color + '1A' : 'transparent'; }}
      >
        {seg.content}
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 pointer-events-none text-sm select-none">
          {style.emoji}
        </span>
      </span>
    );
  };

  return (
    <div className={cn("leading-loose text-base whitespace-pre-wrap break-words", className)}>
      {segments.map((seg, idx) => renderSegment(seg, idx))}
    </div>
  );
}
