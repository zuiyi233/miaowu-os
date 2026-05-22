'use client';

import { BookOpen, PenLine, Star } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface NovelBookCardProps {
  title: string;
  description?: string;
  coverImage?: string;
  chapterCount?: number;
  wordCount?: number;
  genre?: string;
  lastUpdated?: Date;
  onClick?: () => void;
}

export const NovelBookCard: React.FC<NovelBookCardProps> = ({
  title,
  description,
  coverImage,
  chapterCount = 0,
  wordCount = 0,
  genre,
  lastUpdated,
  onClick,
}) => {
  return (
    <Card
      className="group cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all duration-300 overflow-hidden"
      onClick={onClick}
    >
      <div className="flex gap-4 p-4">
        <div className="w-24 h-32 rounded-md overflow-hidden shrink-0 bg-muted flex items-center justify-center">
          {coverImage ? (
            <img src={coverImage} alt={title} className="w-full h-full object-cover" />
          ) : (
            <BookOpen className="w-8 h-8 text-muted-foreground/30" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-bold text-base truncate group-hover:text-primary transition-colors">
              {title}
            </h3>
            {genre && <Badge variant="secondary" className="text-[10px]">{genre}</Badge>}
          </div>

          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {description}
            </p>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <PenLine className="h-3 w-3" />
              {chapterCount} 章
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {wordCount > 10000 ? `${(wordCount / 10000).toFixed(1)}万字` : `${wordCount}字`}
            </span>
          </div>

          {lastUpdated && (
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              最后更新：{lastUpdated.toLocaleDateString('zh-CN')}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
