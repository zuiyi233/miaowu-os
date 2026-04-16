'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Edit, Trash2, Search, FileText, Star } from 'lucide-react';
import { usePromptTemplatesQuery, useActivePromptTemplateQuery } from '@/core/novel/queries';
import type { PromptTemplate } from '@/core/novel/schemas';

const PROMPT_TYPES = [
  { value: 'outline', label: '大纲生成' },
  { value: 'continue', label: '继续写作' },
  { value: 'polish', label: '文字润色' },
  { value: 'expand', label: '场景扩写' },
  { value: 'chat', label: '对话生成' },
  { value: 'extraction', label: '实体提取' },
];

interface PromptTemplateManagerProps {
  novelTitle: string;
  onSave?: (template: PromptTemplate) => void;
  onDelete?: (id: string) => void;
  onActivate?: (id: string, type: string) => void;
}

export function PromptTemplateManager({ novelTitle, onSave, onDelete, onActivate }: PromptTemplateManagerProps) {
  const { data: templates } = usePromptTemplatesQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const filtered = (templates || []).filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || t.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleSubmit = (data: any) => {
    onSave?.(data);
    setShowCreate(false);
    setEditingTemplate(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Prompt Templates
          </h3>
          <Button size="sm" className="gap-1 h-7" onClick={() => { setEditingTemplate(null); setShowCreate(true); }}>
            <Plus className="h-3 w-3" />
            New
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              className="pl-8 h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Filter type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {PROMPT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No templates found. Click &quot;New&quot; to create one.
            </div>
          ) : (
            filtered.map((template) => (
              <Card key={template.id} className="hover:bg-accent/50 transition-colors">
                <CardHeader className="p-3 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm">{template.name}</CardTitle>
                        {template.isBuiltIn && <Badge variant="secondary" className="text-xs">Built-in</Badge>}
                        {template.isActive && <Badge variant="default" className="text-xs h-4 px-1"><Star className="h-3 w-3" /></Badge>}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {PROMPT_TYPES.find((t) => t.value === template.type)?.label || template.type}
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      {!template.isBuiltIn && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => setEditingTemplate(template)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => onDelete?.(template.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {template.description && (
                  <CardContent className="p-3 pt-1 text-xs text-muted-foreground line-clamp-2">
                    {template.description}
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      <PromptTemplateDialog
        open={showCreate || !!editingTemplate}
        onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditingTemplate(null); } }}
        onSubmit={handleSubmit}
        initialData={editingTemplate}
      />
    </div>
  );
}

function PromptTemplateDialog({ open, onOpenChange, onSubmit, initialData }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (data: any) => void; initialData?: PromptTemplate | null }) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [type, setType] = useState<PromptTemplate['type']>(initialData?.type || 'outline');
  const [content, setContent] = useState(initialData?.content || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      id: initialData?.id || crypto.randomUUID(),
      name,
      description,
      type: type as PromptTemplate['type'],
      content,
      isBuiltIn: initialData?.isBuiltIn || false,
      isActive: initialData?.isActive || false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{initialData ? 'Edit Template' : 'Create Template'}</DialogTitle>
            <DialogDescription>
              {initialData ? 'Update' : 'Create a new'} prompt template for AI assistance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Template Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., My Novel Outline Prompt" required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as PromptTemplate['type'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of when to use this template" />
            </div>
            <div className="space-y-2">
              <Label>Prompt Content</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your prompt here. Use {variables} for dynamic content."
                rows={10}
                className="font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use {'{variable}'} syntax for template variables (e.g., {'{character_name}'}, {'{scene_description}'})
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || !content.trim()}>
              {initialData ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
