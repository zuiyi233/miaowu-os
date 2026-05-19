'use client';

import { Edit, Trash2, User, Building2, Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useI18n } from '@/core/i18n/hooks';
import { cn } from '@/lib/utils';

interface CharacterCardProps {
  character: {
    id: string; name: string; role_type?: string; status?: string;
    is_organization?: boolean; age?: string; gender?: string;
    personality?: string; relationships?: string; organization_type?: string;
    power_level?: number; location?: string; motto?: string;
    organization_purpose?: string; organization_members?: unknown; background?: string;
  };
  onEdit?: (character: CharacterCardProps['character']) => void;
  onDelete: (id: string) => void;
  onExport?: () => void;
}

const roleColors: Record<string, string> = { protagonist: 'blue', supporting: 'green', antagonist: 'red' };

export function CharacterCard({ character, onEdit, onDelete, onExport }: CharacterCardProps) {
  const { t } = useI18n();
  const isOrg = character.is_organization;
  const isInactive = character.status && character.status !== 'active';

  const roleLabels: Record<string, string> = {
    protagonist: t.novel.protagonist,
    supporting: t.novel.supporting,
    antagonist: t.novel.antagonist,
  };

  const statusConfig: Record<string, { label: string; cls: string }> = {
    deceased: { label: `💀 ${t.novel.deceased}`, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    missing: { label: `❓ ${t.novel.missing}`, cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
    retired: { label: `📤 ${t.novel.exited}`, cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
    destroyed: { label: `💀 ${t.novel.destroyed}`, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  };

  const statusTag = character.status ? statusConfig[character.status] : null;

  return (
    <Card className={cn("transition-all hover:shadow-md", isInactive && "opacity-60 grayscale-[40%]")}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex shrink-0 items-center justify-center w-12 h-12 rounded-lg", isOrg ? "bg-green-50 dark:bg-green-950/30" : "bg-primary/10")}>
            {isOrg ? <Building2 className="w-6 h-6 text-green-600" /> : <User className="w-6 h-6 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-semibold truncate">{character.name}</span>
              {isOrg ? (
                <Badge variant="default" className="bg-green-600 text-white">{t.novel.organizations}</Badge>
              ) : character.role_type ? (
                <Badge variant="secondary" className={cn(roleColors[character.role_type] === 'blue' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300')}>
                  {roleLabels[character.role_type] || character.role_type}
                </Badge>
              ) : null}
              {statusTag && <Badge variant="secondary" className={statusTag.cls}>{statusTag.label}</Badge>}
            </div>
            <div className="space-y-1 text-sm">
              {!isOrg && (
                <>
                  {character.age && <InfoRow label={t.novel.age} value={character.age} />}
                  {character.gender && <InfoRow label={t.novel.gender} value={character.gender} />}
                  {character.personality && <InfoRow label={t.novel.personality} value={character.personality} truncate />}
                  {character.relationships && <InfoRow label={t.novel.relationships} value={character.relationships} truncate />}
                </>
              )}
              {isOrg && (
                <>
                  {character.organization_type && (
                    <div className="flex gap-1.5"><span className="shrink-0 text-muted-foreground text-xs">{t.novel.typeLabel}</span><Badge variant="secondary">{character.organization_type}</Badge></div>
                  )}
                  {character.power_level != null && (
                    <div className="flex gap-1.5">
                      <span className="shrink-0 text-muted-foreground text-xs">{t.novel.factionLevel}</span>
                      <Badge variant={character.power_level >= 70 ? 'destructive' : character.power_level >= 50 ? 'outline' : 'secondary'}>
                        {character.power_level}
                      </Badge>
                    </div>
                  )}
                  {character.location && <InfoRow label={t.novel.location} value={character.location} />}
                  {character.motto && <InfoRow label={t.novel.motto} value={character.motto} />}
                  {character.organization_purpose && <InfoRow label={t.novel.purpose} value={character.organization_purpose} />}
                </>
              )}
              {character.background && <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{character.background}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-3 pt-3 border-t">
          {onEdit && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(character)}>
              <Edit className="w-3 h-3 mr-1" />{t.novel.edit}
            </Button>
          )}
          {onExport && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onExport}>
              <Download className="w-3 h-3 mr-1" />{t.novel.export}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
            onClick={() => {
              if (window.confirm(character.is_organization ? t.novel.confirmDeleteOrgEntity : t.novel.confirmDeleteEntity)) {
                onDelete(character.id);
              }
            }}>
            <Trash2 className="w-3 h-3 mr-1" />{t.common.delete}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-muted-foreground text-xs">{label}：</span>
      <span className={cn("text-foreground", truncate && "truncate")}>{value}</span>
    </div>
  );
}
