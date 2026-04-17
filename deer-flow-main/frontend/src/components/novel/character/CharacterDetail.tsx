'use client';

import { Pencil } from 'lucide-react';
import React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Character } from '@/core/novel/schemas';

interface CharacterDetailProps {
  character: Character;
  onEdit?: () => void;
}

export const CharacterDetail: React.FC<CharacterDetailProps> = ({
  character,
  onEdit,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={character.avatar} />
            <AvatarFallback>{character.name[0]}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-lg font-semibold">{character.name}</h3>
            {character.age && (
              <p className="text-sm text-muted-foreground">
                {character.age} {character.gender}
              </p>
            )}
          </div>
        </div>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="h-[400px] pr-4">
        {character.description && (
          <Card>
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">简介</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {character.description}
              </p>
            </CardContent>
          </Card>
        )}

        {character.appearance && (
          <Card className="mt-3">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">外貌描述</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {character.appearance}
              </p>
            </CardContent>
          </Card>
        )}

        {character.personality && (
          <Card className="mt-3">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">性格特点</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {character.personality}
              </p>
            </CardContent>
          </Card>
        )}

        {character.motivation && (
          <Card className="mt-3">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">动机与目标</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {character.motivation}
              </p>
            </CardContent>
          </Card>
        )}

        {character.backstory && (
          <Card className="mt-3">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">背景故事</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {character.backstory}
              </p>
            </CardContent>
          </Card>
        )}
      </ScrollArea>

      {character.factionId && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">所属势力：</span>
          <Badge variant="secondary">{character.factionId}</Badge>
        </div>
      )}
    </div>
  );
};
