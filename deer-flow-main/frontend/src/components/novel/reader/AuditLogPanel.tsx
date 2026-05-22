'use client';

import { ScrollText, Clock, Filter, FileEdit, Plus, Trash2, RefreshCw, Download } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NovelAuditEntry } from '@/core/novel/novel-api';

interface AuditLogPanelProps {
  entries: NovelAuditEntry[];
  onExport?: () => void;
}

const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  restore: 'bg-purple-100 text-purple-800',
  export: 'bg-yellow-100 text-yellow-800',
  import: 'bg-orange-100 text-orange-800',
};

const actionLabels: Record<string, string> = {
  create: '创建',
  update: '修改',
  delete: '删除',
  restore: '恢复',
  export: '导出',
  import: '导入',
};

const entityLabels: Record<string, string> = {
  novel: '小说',
  chapter: '章节',
  entity: '实体',
  character: '角色',
  setting: '场景',
  timeline: '时间线',
  graph: '关系图',
  relationship: '关系',
  template: '模板',
  interaction: '互动',
  recommendation: '建议',
  quality: '质量',
};

export function AuditLogPanel({ entries, onExport }: AuditLogPanelProps) {
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterEntity, setFilterEntity] = useState<string>('all');
  const [filterAuthor, setFilterAuthor] = useState<string>('all');

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (filterAction !== 'all') result = result.filter((e) => e.action === filterAction);
    if (filterEntity !== 'all') result = result.filter((e) => e.entityType === filterEntity);
    if (filterAuthor !== 'all') result = result.filter((e) => e.author === filterAuthor);
    return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [entries, filterAction, filterEntity, filterAuthor]);

  const uniqueAuthors = useMemo(() => [...new Set(entries.map((e) => e.author))], [entries]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            <CardTitle>变更审计</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="mr-1 h-3 w-3" /> 导出
            </Button>
          </div>
        </div>
        <CardDescription>
          记录所有创作内容的变更历史，便于追踪和回溯
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 p-3 border rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">筛选:</span>
          </div>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="操作类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部操作</SelectItem>
              <SelectItem value="create">创建</SelectItem>
              <SelectItem value="update">修改</SelectItem>
              <SelectItem value="delete">删除</SelectItem>
              <SelectItem value="restore">恢复</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterEntity} onValueChange={setFilterEntity}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="实体类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="novel">小说</SelectItem>
              <SelectItem value="chapter">章节</SelectItem>
              <SelectItem value="entity">实体</SelectItem>
              <SelectItem value="character">角色</SelectItem>
              <SelectItem value="timeline">时间线</SelectItem>
              <SelectItem value="graph">关系图</SelectItem>
              <SelectItem value="interaction">互动</SelectItem>
              <SelectItem value="recommendation">建议</SelectItem>
              <SelectItem value="template">模板</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterAuthor} onValueChange={setFilterAuthor}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="操作人" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {uniqueAuthors.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Audit log entries */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Clock className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>暂无变更记录</p>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="mt-0.5">
                  {entry.action === 'create' && <Plus className="h-4 w-4 text-green-500" />}
                  {entry.action === 'update' && <FileEdit className="h-4 w-4 text-blue-500" />}
                  {entry.action === 'delete' && <Trash2 className="h-4 w-4 text-red-500" />}
                  {entry.action === 'restore' && <RefreshCw className="h-4 w-4 text-purple-500" />}
                  {entry.action === 'export' && <Download className="h-4 w-4 text-yellow-500" />}
                  {entry.action === 'import' && <Download className="h-4 w-4 text-orange-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`text-xs ${actionColors[entry.action]}`}>
                      {actionLabels[entry.action]}
                    </Badge>
                    <span className="text-sm font-medium">{entry.entityName}</span>
                    <Badge variant="outline" className="text-xs">
                      {entityLabels[entry.entityType]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{entry.details}</p>
                  {entry.reason && (
                    <p className="text-xs text-muted-foreground mt-1">
                      原因: {entry.reason}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {entry.timestamp.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">操作人: {entry.author}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 text-xs text-muted-foreground text-right">
          共 {filteredEntries.length} 条记录 {filteredEntries.length !== entries.length && `(筛选自 ${entries.length} 条)`}
        </div>
      </CardContent>
    </Card>
  );
}
