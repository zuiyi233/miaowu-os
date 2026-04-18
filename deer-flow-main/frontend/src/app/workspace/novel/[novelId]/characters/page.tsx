'use client';

import { Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { CharacterCard } from '@/components/novel/CharacterCard';
import { CharacterEditForm } from '@/components/novel/forms/CharacterEditForm';
import { CharacterForm } from '@/components/novel/forms/CharacterForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeleteCharacterMutation, useNovelQuery } from '@/core/novel/queries';
import type { Character } from '@/core/novel/schemas';

export default function CharactersPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  const { data: novelData, isLoading } = useNovelQuery(novelId);
  const deleteCharacter = useDeleteCharacterMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);

  const characters = useMemo(
    () => [...(novelData?.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [novelData?.characters],
  );

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              角色管理
            </CardTitle>
            <CardDescription>使用现有角色组件提供基础 CRUD，满足迁移路由可达与可用。</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />新增角色
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">加载角色中...</p> : null}

          {!isLoading && characters.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前没有角色，点击“新增角色”开始创建。</p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onEdit={() => setEditingCharacter(character)}
                onDelete={(characterId) => deleteCharacter.mutate(characterId)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新增角色</DialogTitle>
          </DialogHeader>
          <CharacterForm novelId={novelId} onSubmitSuccess={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCharacter} onOpenChange={(open) => !open && setEditingCharacter(null)}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑角色</DialogTitle>
          </DialogHeader>
          {editingCharacter ? (
            <CharacterEditForm
              character={editingCharacter}
              onSubmitSuccess={() => setEditingCharacter(null)}
              onDelete={() => setEditingCharacter(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
