'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ActivityHeatmapProps {
  data: Record<string, number>;
  startDate?: Date;
  endDate?: Date;
  onDateClick?: (date: string, count: number) => void;
}

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({
  data,
  startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
  endDate = new Date(),
  onDateClick,
}) => {
  const weeks: string[][] = [];
  let currentWeek: string[] = [];

  const date = new Date(startDate);
  while (date <= endDate) {
    if (date.getDay() === 0 && currentWeek.length > 0) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
    currentWeek.push(date.toISOString().split('T')[0]);
    date.setDate(date.getDate() + 1);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-muted/30';
    if (count <= 2) return 'bg-green-200 dark:bg-green-900/30';
    if (count <= 5) return 'bg-green-300 dark:bg-green-800/40';
    if (count <= 10) return 'bg-green-400 dark:bg-green-700/50';
    return 'bg-green-500 dark:bg-green-600/60';
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex gap-1">
            {week.map((dateStr, di) => {
              const count = data[dateStr] || 0;
              return (
                <div
                  key={dateStr}
                  className={`w-3 h-3 rounded-sm ${getColor(count)} cursor-pointer hover:ring-1 hover:ring-primary transition-all`}
                  title={`${dateStr}: ${count} 次创作`}
                  onClick={() => onDateClick?.(dateStr, count)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
        <span>少</span>
        <div className="flex gap-0.5">
          <div className="w-3 h-3 rounded-sm bg-muted/30" />
          <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900/30" />
          <div className="w-3 h-3 rounded-sm bg-green-300 dark:bg-green-800/40" />
          <div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700/50" />
          <div className="w-3 h-3 rounded-sm bg-green-500 dark:bg-green-600/60" />
        </div>
        <span>多</span>
      </div>
    </div>
  );
};
