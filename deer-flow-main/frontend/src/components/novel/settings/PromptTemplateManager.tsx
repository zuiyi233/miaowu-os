'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { usePromptTemplatesQuery } from '@/core/novel/queries';
import { useI18n } from '@/core/i18n/hooks';
import type { PromptTemplate } from '@/core/novel/schemas';

type PromptTypeOption = {
  value: PromptTemplate['type'];
  label: string;
};

interface PromptTemplateManagerProps {
  novelId: string;
  onSave?: (template: PromptTemplate) => void;
  onDelete?: (id: string) => void;
  onActivate?: (id: string, type: string) => void;
}

export function PromptTemplateManager({
  onSave,
  onDelete,
}: PromptTemplateManagerProps) {
  const { t } = useI18n();
  const { data: templates } = usePromptTemplatesQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const promptTypes: PromptTypeOption[] = useMemo(
    () => [
      { value: 'outline', label: t.novel.outlineGen },
      { value: 'continue', label: t.novel.continueWrite },
      { value: 'polish', label: t.novel.polish },
      { value: 'expand', label: t.novel.expand },
      { value: 'chat', label: t.novel.chat },
      { value: 'extraction', label: t.novel.extraction },
    ],
    [t]
  );

  const filtered = (templates || []).filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || template.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleSubmit = (data: PromptTemplate) => {
    onSave?.(data);
    setShowCreate(false);
    setEditingTemplate(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-medium">
            <FileText className="h-4 w-4" />
            {t.novel.promptTemplates}
          </h3>
          <Button
            size="sm"
            className="h-7 gap-1"
            onClick={() => {
              setEditingTemplate(null);
              setShowCreate(true);
            }}
          >
            <Plus className="h-3 w-3" />
            {t.novel.newTemplate}
          </Button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
            <Input
              placeholder={t.novel.searchTemplates}
              className="h-9 pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder={t.novel.filterType} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.novel.allTypes}</SelectItem>
              {promptTypes.map((promptType) => (
                <SelectItem key={promptType.value} value={promptType.value}>
                  {promptType.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {t.novel.noTemplatesFound}
            </div>
          ) : (
            filtered.map((template) => (
              <Card key={template.id} className="transition-colors hover:bg-accent/50">
                <CardHeader className="p-3 pb-0">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm">{template.name}</CardTitle>
                        {template.isBuiltIn && (
                          <Badge variant="secondary" className="text-xs">
                            {t.novel.builtIn}
                          </Badge>
                        )}
                        {template.isActive && (
                          <Badge variant="default" className="h-4 px-1 text-xs">
                            <Star className="h-3 w-3" />
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {promptTypes.find((promptType) => promptType.value === template.type)
                          ?.label || template.type}
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
                            className="text-destructive hover:text-destructive h-6 w-6 p-0"
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
                  <CardContent className="text-muted-foreground line-clamp-2 p-3 pt-1 text-xs">
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
        onOpenChange={(open) => {
          if (!open) {
            setShowCreate(false);
            setEditingTemplate(null);
          }
        }}
        onSubmit={handleSubmit}
        initialData={editingTemplate}
        promptTypes={promptTypes}
      />
    </div>
  );
}

function PromptTemplateDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  promptTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PromptTemplate) => void;
  initialData?: PromptTemplate | null;
  promptTypes: PromptTypeOption[];
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PromptTemplate['type']>('outline');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(initialData?.name || '');
    setDescription(initialData?.description || '');
    setType(initialData?.type || 'outline');
    setContent(initialData?.content || '');
  }, [initialData, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmit({
      id: initialData?.id || crypto.randomUUID(),
      name,
      description,
      type,
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
            <DialogTitle>
              {initialData ? t.novel.editTemplate : t.novel.createTemplate}
            </DialogTitle>
            <DialogDescription>
              {initialData
                ? t.novel.updateTemplateDescription
                : t.novel.createTemplateDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t.novel.templateName}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.novel.templateNamePlaceholder}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>{t.novel.type}</Label>
              <Select value={type} onValueChange={(value) => setType(value as PromptTemplate['type'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {promptTypes.map((promptType) => (
                    <SelectItem key={promptType.value} value={promptType.value}>
                      {promptType.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t.novel.entityDescription}</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.novel.descriptionPlaceholder(t.novel.templateName)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t.novel.promptContent}</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t.novel.promptContentPlaceholder}
                rows={10}
                className="font-mono text-sm"
                required
              />
              <p className="text-muted-foreground text-xs">{t.novel.templateVariableHint}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.novel.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim() || !content.trim()}>
              {initialData ? t.novel.update : t.novel.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
