'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, GitCompare, History, RotateCcw } from 'lucide-react';
import type { ChapterSnapshot } from '@/core/novel/database';

interface VersionDiffProps {
  chapterId: string;
  currentContent: string;
  snapshots: ChapterSnapshot[];
  onRestore?: (content: string, snapshot: ChapterSnapshot) => void;
  onLoadSnapshot?: (snapshot: ChapterSnapshot) => void;
}

function computeParagraphDiff(
  oldText: string,
  newText: string
): Array<{
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  oldIndex: number | null;
  newIndex: number | null;
  oldText: string;
  newText: string;
}> {
  const oldParagraphs = oldText.split(/\n+/).filter((p) => p.trim());
  const newParagraphs = newText.split(/\n+/).filter((p) => p.trim());

  const result: Array<{
    type: 'unchanged' | 'added' | 'removed' | 'modified';
    oldIndex: number | null;
    newIndex: number | null;
    oldText: string;
    newText: string;
  }> = [];

  const maxLen = Math.max(oldParagraphs.length, newParagraphs.length);

  for (let i = 0; i < maxLen; i++) {
    const oldP = oldParagraphs[i] ?? null;
    const newP = newParagraphs[i] ?? null;

    if (oldP === null && newP !== null) {
      result.push({ type: 'added', oldIndex: null, newIndex: i, oldText: '', newText: newP });
    } else if (oldP !== null && newP === null) {
      result.push({ type: 'removed', oldIndex: i, newIndex: null, oldText: oldP, newText: '' });
    } else if (oldP !== null && newP !== null && oldP === newP) {
      result.push({ type: 'unchanged', oldIndex: i, newIndex: i, oldText: oldP, newText: newP });
    } else {
      result.push({
        type: 'modified',
        oldIndex: i,
        newIndex: i,
        oldText: oldP ?? '',
        newText: newP ?? '',
      });
    }
  }

  return result;
}

export function VersionDiff({ chapterId, currentContent, snapshots, onRestore, onLoadSnapshot }: VersionDiffProps) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  const selectedSnapshot = useMemo(
    () => snapshots.find((s) => s.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId]
  );

  const diffResult = useMemo(() => {
    if (!selectedSnapshot) return [];
    const oldText = selectedSnapshot.content.replace(/<[^>]*>/g, '').trim();
    const newText = currentContent.replace(/<[^>]*>/g, '').trim();
    return computeParagraphDiff(oldText, newText);
  }, [selectedSnapshot, currentContent]);

  const stats = useMemo(() => {
    const added = diffResult.filter((d) => d.type === 'added').length;
    const removed = diffResult.filter((d) => d.type === 'removed').length;
    const modified = diffResult.filter((d) => d.type === 'modified').length;
    return { added, removed, modified, unchanged: diffResult.length - added - removed - modified };
  }, [diffResult]);

  const toggleSection = useCallback((index: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedSections(new Set(diffResult.map((_, i) => i)));
  }, [diffResult]);

  const expandAll = useCallback(() => {
    setCollapsedSections(new Set());
  }, []);

  const handleRestore = useCallback(() => {
    if (selectedSnapshot) {
      onRestore?.(selectedSnapshot.content, selectedSnapshot);
    }
  }, [selectedSnapshot, onRestore]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            <CardTitle>版本对比</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={showDiff ? expandAll : collapseAll}>
              {showDiff ? '收起全部' : '展开全部'}
            </Button>
          </div>
        </div>
        <CardDescription>选择历史快照，对比当前版本与历史版本的差异</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Snapshot selector */}
        <div className="flex items-center gap-3">
          <History className="h-4 w-4" />
          <Select
            value={selectedSnapshotId?.toString() ?? ''}
            onValueChange={(v) => setSelectedSnapshotId(v ? Number(v) : null)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="选择历史版本..." />
            </SelectTrigger>
            <SelectContent>
              {snapshots
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .map((s) => (
                  <SelectItem key={s.id} value={s.id!.toString()}>
                    {s.description || `版本 ${s.version || s.id}`} — {s.timestamp.toLocaleString()}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stats badges */}
        {selectedSnapshot && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              +{stats.added} 新增
            </Badge>
            <Badge variant="secondary" className="bg-red-100 text-red-800">
              -{stats.removed} 删除
            </Badge>
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
              ~{stats.modified} 修改
            </Badge>
            <Badge variant="outline">{stats.unchanged} 未变</Badge>
          </div>
        )}

        {/* Restore button */}
        {selectedSnapshot && onRestore && (
          <Button onClick={handleRestore} variant="outline" className="w-full">
            <RotateCcw className="mr-2 h-4 w-4" /> 恢复到该版本
          </Button>
        )}

        {/* Diff display */}
        {showDiff && selectedSnapshot && (
          <div className="border rounded-md overflow-hidden">
            <div className="grid grid-cols-2 gap-0">
              <div className="px-3 py-2 border-b bg-gray-50 text-xs font-semibold text-gray-600">
                历史版本 ({selectedSnapshot.timestamp.toLocaleDateString()})
              </div>
              <div className="px-3 py-2 border-b bg-gray-50 text-xs font-semibold text-gray-600 border-l">
                当前版本
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y">
              {diffResult.map((diff, i) => (
                <div key={i} className={`grid grid-cols-2 transition-colors ${
                  diff.type === 'added' ? 'bg-green-50' :
                  diff.type === 'removed' ? 'bg-red-50' :
                  diff.type === 'modified' ? 'bg-yellow-50' : ''
                }`}>
                  <div className={`px-3 py-2 text-sm border-r ${collapsedSections.has(i) ? 'truncate max-h-6' : ''}`}>
                    {diff.oldText || <span className="text-gray-400 italic">(无)</span>}
                  </div>
                  <div className={`px-3 py-2 text-sm ${collapsedSections.has(i) ? 'truncate max-h-6' : ''}`}>
                    {diff.newText || <span className="text-gray-400 italic">(无)</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
