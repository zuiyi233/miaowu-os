'use client';

import { Pencil, Trash2, ChevronRight } from 'lucide-react';
import React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface EntityCardProps {
  title: string;
  subtitle?: string;
  avatar?: string;
  icon?: React.ReactNode;
  tags?: string[];
  description?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  children?: React.ReactNode;
}

export const EntityCard: React.FC<EntityCardProps> = ({
  title,
  subtitle,
  avatar,
  icon,
  tags,
  description,
  onEdit,
  onDelete,
  onClick,
  children,
}) => {
  return (
    <Card
      className="group cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {avatar ? (
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={avatar} />
              <AvatarFallback>{title[0]}</AvatarFallback>
            </Avatar>
          ) : icon ? (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              {icon}
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold truncate">{title}</h3>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onEdit && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {onDelete && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}

            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {description}
              </p>
            )}
          </div>

          <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0 mt-1" />
        </div>

        {children}
      </CardContent>
    </Card>
  );
};
