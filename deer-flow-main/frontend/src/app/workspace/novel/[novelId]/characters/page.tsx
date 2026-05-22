'use client';

import { Plus, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CharacterCard } from '@/components/novel/CharacterCard';
import { CharacterEditForm } from '@/components/novel/forms/CharacterEditForm';
import { CharacterForm } from '@/components/novel/forms/CharacterForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/core/i18n/hooks';
import { useDeleteCharacterMutation, useNovelQuery } from '@/core/novel/queries';
import type { Character } from '@/core/novel/schemas';

export default function CharactersPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');
  const { t } = useI18n();
  const { data: novelData, isLoading } = useNovelQuery(novelId);
  const deleteCharacter = useDeleteCharacterMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);

  const characters = useMemo(
    () => [...(novelData?.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [novelData?.characters],
  );

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t.novel.characterManagement}
            </CardTitle>
            <CardDescription>{t.novel.characterManagementDescription}</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />{t.novel.addCharacter}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">{t.novel.loadingCharacters}</p> : null}

          {!isLoading && characters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.novel.noCharactersYet}</p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onEdit={() => setEditingCharacter(character)}
                onDelete={(characterId) => deleteCharacter.mutate({ novelId, characterId })}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.novel.addCharacter}</DialogTitle>
          </DialogHeader>
          <CharacterForm novelId={novelId} onSubmitSuccess={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCharacter} onOpenChange={(open) => !open && setEditingCharacter(null)}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.novel.editCharacter}</DialogTitle>
          </DialogHeader>
          {editingCharacter ? (
            <CharacterEditForm
              novelId={novelId}
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
