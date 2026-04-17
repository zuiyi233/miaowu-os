'use client';

import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GenericEntitySectionProps<T> {
  title: string;
  items: T[];
  searchPlaceholder?: string;
  onCreate?: () => void;
  onSearch?: (query: string) => void;
  renderHeader?: (item: T) => React.ReactNode;
  renderContent?: (item: T) => React.ReactNode;
  onToggle?: () => void;
  isCollapsed?: boolean;
  id?: string;
}

export const GenericEntitySection = <T extends { id: string }>({
  title,
  items,
  searchPlaceholder = '搜索...',
  onCreate,
  onSearch,
  renderHeader,
  renderContent,
  onToggle,
  isCollapsed,
  id,
}: GenericEntitySectionProps<T>) => {
  const [search, setSearch] = React.useState('');

  const handleSearch = (value: string) => {
    setSearch(value);
    onSearch?.(value);
  };

  return (
    <div id={id} className="border-b">
      <div
        className="flex items-center justify-between p-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5">
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">{title}</span>
          <span className="text-[10px] text-muted-foreground">({items.length})</span>
        </div>
        {onCreate && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => {
              e.stopPropagation();
              onCreate();
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {!isCollapsed && (
        <div className="p-2 space-y-2">
          {items.length > 5 && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
          )}

          <ScrollArea className="max-h-[200px]">
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.id} className="p-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
                  {renderHeader?.(item)}
                  {renderContent?.(item)}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};
