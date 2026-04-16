'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';

interface MentionListProps {
  items: Array<{ id: string; name: string; type: string; description?: string }>;
  onSelect?: (item: { id: string; name: string; type: string }) => void;
  onCreateNew?: (name: string, type: string) => void;
  type: 'character' | 'setting' | 'faction' | 'item';
}

export const MentionList: React.FC<MentionListProps> = ({
  items,
  onSelect,
  onCreateNew,
  type,
}) => {
  const [search, setSearch] = React.useState('');
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [newName, setNewName] = React.useState('');

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (newName.trim()) {
      onCreateNew?.(newName.trim(), type);
      setNewName('');
      setShowCreateDialog(false);
    }
  };

  const typeLabels = {
    character: '角色',
    setting: '场景',
    faction: '势力',
    item: '物品',
  };

  return (
    <div className="w-[300px] rounded-lg border bg-popover p-2 shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <Input
          placeholder={`搜索${typeLabels[type]}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建新{typeLabels[type]}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label>{typeLabels[type]}名称</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`输入${typeLabels[type]}名称`}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <Button className="w-full" onClick={handleCreate}>
                创建
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="max-h-[200px] overflow-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            未找到匹配的{typeLabels[type]}
          </p>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-sm transition-colors"
              onClick={() => onSelect?.(item)}
            >
              <p className="font-medium">{item.name}</p>
              {item.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {item.description}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
