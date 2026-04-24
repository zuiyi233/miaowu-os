'use client';

import { Edit, Trash2, User, Building2, Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CharacterCardProps {
  character: {
    id: string;
    name: string;
    role_type?: string;
    status?: string;
    is_organization?: boolean;
    age?: string;
    gender?: string;
    personality?: string;
    relationships?: string;
    organization_type?: string;
    power_level?: number;
    location?: string;
    motto?: string;
    organization_purpose?: string;
    organization_members?: unknown;
    background?: string;
  };
  onEdit?: (character: CharacterCardProps['character']) => void;
  onDelete: (id: string) => void;
  onExport?: () => void;
}

const roleLabels: Record<string, string> = { protagonist: '主角', supporting: '配角', antagonist: '反派' };
const roleColors: Record<string, string> = { protagonist: 'blue', supporting: 'green', antagonist: 'red' };

const statusConfig: Record<string, { label: string; cls: string }> = {
  deceased: { label: '💀 已死亡', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  missing: { label: '❓ 已失踪', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  retired: { label: '📤 已退场', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  destroyed: { label: '💀 已覆灭', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

export function CharacterCard({ character, onEdit, onDelete, onExport }: CharacterCardProps) {
  const isOrg = character.is_organization;
  const isInactive = character.status && character.status !== 'active';
  const statusTag = character.status ? statusConfig[character.status] : null;

  return (
    <Card className={cn("transition-all hover:shadow-md", isInactive && "opacity-60 grayscale-[40%]")}>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex shrink-0 items-center justify-center w-12 h-12 rounded-lg",
            isOrg ? "bg-green-50 dark:bg-green-950/30" : "bg-primary/10"
          )}>
            {isOrg
              ? <Building2 className="w-6 h-6 text-green-600" />
              : <User className="w-6 h-6 text-primary" />
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-semibold truncate">{character.name}</span>
              {isOrg ? (
                <Badge variant="default" className="bg-green-600 text-white">组织</Badge>
              ) : character.role_type ? (
                <Badge variant="secondary" className={cn(roleColors[character.role_type] === 'blue' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300')}>
                  {roleLabels[character.role_type] || character.role_type}
                </Badge>
              ) : null}
              {statusTag && (
                <Badge variant="secondary" className={statusTag.cls}>{statusTag.label}</Badge>
              )}
            </div>

            <div className="space-y-1 text-sm">
              {!isOrg && (
                <>
                  {character.age && <InfoRow label="年龄" value={character.age} />}
                  {character.gender && <InfoRow label="性别" value={character.gender} />}
                  {character.personality && <InfoRow label="性格" value={character.personality} truncate />}
                  {character.relationships && <InfoRow label="关系" value={character.relationships} truncate />}
                </>
              )}

              {isOrg && (
                <>
                  {character.organization_type && (
                    <div className="flex gap-1.5"><span className="shrink-0 text-muted-foreground text-xs">类型：</span><Badge variant="secondary">{character.organization_type}</Badge></div>
                  )}
                  {character.power_level != null && (
                    <div className="flex gap-1.5">
                      <span className="shrink-0 text-muted-foreground text-xs">势力等级：</span>
                      <Badge variant={character.power_level >= 70 ? 'destructive' : character.power_level >= 50 ? 'outline' : 'secondary'}>
                        {character.power_level}
                      </Badge>
                    </div>
                  )}
                  {character.location && <InfoRow label="所在地" value={character.location} />}
                  {character.motto && <InfoRow label="格言" value={character.motto} />}
                  {character.organization_purpose && <InfoRow label="目的" value={character.organization_purpose} />}
                </>
              )}

              {character.background && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{character.background}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-3 pt-3 border-t">
          {onEdit && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(character)}>
              <Edit className="w-3 h-3 mr-1" />编辑
            </Button>
          )}
          {onExport && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onExport}>
              <Download className="w-3 h-3 mr-1" />导出
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
            onClick={() => {
              if (window.confirm('确定要删除这个' + (character.is_organization ? '组织' : '角色') + '吗？此操作不可撤销。')) {
                onDelete(character.id);
              }
            }}
          >
            <Trash2 className="w-3 h-3 mr-1" />删除
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
