'use client';

import { Search, Plus } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Setting } from '@/core/novel/schemas';

interface VirtualizedSettingListProps {
  settings: Setting[];
  onSettingClick?: (setting: Setting) => void;
  onAddSetting?: () => void;
}

export const VirtualizedSettingList: React.FC<VirtualizedSettingListProps> = ({
  settings,
  onSettingClick,
  onAddSetting,
}) => {
  const [search, setSearch] = React.useState('');

  const filtered = settings.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索场景..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {onAddSetting && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAddSetting}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="h-[200px]">
        <div className="space-y-1">
          {filtered.map((setting) => (
            <button
              key={setting.id}
              className="w-full p-2 rounded-md hover:bg-accent/50 transition-colors text-left"
              onClick={() => onSettingClick?.(setting)}
            >
              <p className="text-xs font-medium truncate">{setting.name}</p>
              {setting.description && (
                <p className="text-[10px] text-muted-foreground truncate">
                  {setting.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
