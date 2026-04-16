'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, Users, MapPin, Shield, Package, BookOpen } from 'lucide-react';
import type { Character, Setting, Faction, Item } from '@/core/novel/schemas';

interface ContextRadarProps {
  characters?: Character[];
  settings?: Setting[];
  factions?: Faction[];
  items?: Item[];
  activeChapter?: { title: string; content?: string };
}

export const ContextRadar: React.FC<ContextRadarProps> = ({
  characters = [],
  settings = [],
  factions = [],
  items = [],
  activeChapter,
}) => {
  const getContextStats = () => {
    const stats = [
      { label: '角色', count: characters.length, icon: <Users className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-600' },
      { label: '场景', count: settings.length, icon: <MapPin className="h-4 w-4" />, color: 'bg-green-500/10 text-green-600' },
      { label: '势力', count: factions.length, icon: <Shield className="h-4 w-4" />, color: 'bg-purple-500/10 text-purple-600' },
      { label: '物品', count: items.length, icon: <Package className="h-4 w-4" />, color: 'bg-orange-500/10 text-orange-600' },
    ];
    return stats;
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4" />
          上下文雷达
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {getContextStats().map((stat) => (
            <div key={stat.label} className={`rounded-lg p-2 ${stat.color}`}>
              <div className="flex items-center gap-1.5">
                {stat.icon}
                <span className="text-xs font-medium">{stat.label}</span>
              </div>
              <p className="text-lg font-bold mt-1">{stat.count}</p>
            </div>
          ))}
        </div>

        {activeChapter && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">当前章节</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {activeChapter.title}
            </Badge>
          </div>
        )}

        {characters.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">活跃角色</p>
            <ScrollArea className="h-20">
              <div className="flex flex-wrap gap-1">
                {characters.slice(0, 10).map((char) => (
                  <Badge key={char.id} variant="outline" className="text-[10px]">
                    {char.name}
                  </Badge>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
