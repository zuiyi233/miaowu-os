'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/core/i18n/hooks';
import type { Character, Faction, Item, Setting } from '@/core/novel/schemas';

type EntityType = 'character' | 'faction' | 'setting' | 'item';

interface EntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  entityType: EntityType;
  initialData?: Character | Faction | Setting | Item | null;
  novelId: string;
}

const DEFAULT_ENTITY_TYPE_VALUE = '其他';

export function EntityDialog({
  open,
  onOpenChange,
  onSubmit,
  entityType,
  initialData,
  novelId,
}: EntityDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [extra1, setExtra1] = useState('');
  const [extra2, setExtra2] = useState('');
  const [extra3, setExtra3] = useState('');
  const [extra4, setExtra4] = useState('');

  useEffect(() => {
    if (!initialData || !open) {
      setName('');
      setDescription('');
      setType('');
      setExtra1('');
      setExtra2('');
      setExtra3('');
      setExtra4('');
      return;
    }

    setName(initialData.name || '');
    setDescription(initialData.description || '');
    setType('type' in initialData ? (initialData as any).type || '' : '');

    switch (entityType) {
      case 'character':
        setExtra1((initialData as Character).age || '');
        setExtra2((initialData as Character).gender || '');
        setExtra3((initialData as Character).appearance || '');
        setExtra4((initialData as Character).personality || '');
        break;
      case 'faction':
        setExtra1((initialData as Faction).ideology || '');
        setExtra2((initialData as Faction).goals || '');
        setExtra3((initialData as Faction).structure || '');
        setExtra4((initialData as Faction).resources || '');
        break;
      case 'setting':
        setExtra1((initialData as Setting).atmosphere || '');
        setExtra2((initialData as Setting).history || '');
        setExtra3((initialData as Setting).keyFeatures || '');
        setExtra4('');
        break;
      case 'item':
        setExtra1((initialData as Item).appearance || '');
        setExtra2((initialData as Item).history || '');
        setExtra3((initialData as Item).abilities || '');
        setExtra4('');
        break;
    }
  }, [entityType, initialData, open]);

  const entityLabels: Record<EntityType, string> = {
    character: t.novel.characterSingular,
    faction: t.novel.factionSingular,
    setting: t.novel.settingSingular,
    item: t.novel.itemSingular,
  };

  const extraLabels: Record<EntityType, string[]> = {
    character: [
      t.novel.fieldAge,
      t.novel.fieldGender,
      t.novel.fieldAppearance,
      t.novel.fieldPersonality,
    ],
    faction: [
      t.novel.fieldIdeology,
      t.novel.fieldGoals,
      t.novel.fieldStructure,
      t.novel.fieldResources,
    ],
    setting: [
      t.novel.fieldAtmosphere,
      t.novel.fieldHistory,
      t.novel.fieldKeyFeatures,
    ],
    item: [
      t.novel.fieldAppearance,
      t.novel.fieldHistory,
      t.novel.fieldAbilities,
    ],
  };

  const settingTypeOptions = [
    { value: '城市', label: t.novel.settingTypeCity },
    { value: '建筑', label: t.novel.settingTypeBuilding },
    { value: '自然景观', label: t.novel.settingTypeNaturalLandscape },
    { value: '地区', label: t.novel.settingTypeRegion },
    { value: DEFAULT_ENTITY_TYPE_VALUE, label: t.novel.settingTypeOther },
  ];

  const itemTypeOptions = [
    { value: '关键物品', label: t.novel.itemTypeKeyItem },
    { value: '武器', label: t.novel.itemTypeWeapon },
    { value: '科技装置', label: t.novel.itemTypeTechDevice },
    { value: '普通物品', label: t.novel.itemTypeCommonItem },
    { value: DEFAULT_ENTITY_TYPE_VALUE, label: t.novel.itemTypeOther },
  ];

  const currentEntityLabel = entityLabels[entityType];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const base = {
      id: initialData?.id || crypto.randomUUID(),
      name,
      description,
      novelId,
    };

    const entityData: any = base;

    switch (entityType) {
      case 'character':
        entityData.age = extra1;
        entityData.gender = extra2;
        entityData.appearance = extra3;
        entityData.personality = extra4;
        break;
      case 'faction':
        entityData.ideology = extra1;
        entityData.goals = extra2;
        entityData.structure = extra3;
        entityData.resources = extra4;
        break;
      case 'setting':
        entityData.type = (type || DEFAULT_ENTITY_TYPE_VALUE) as any;
        entityData.atmosphere = extra1;
        entityData.history = extra2;
        entityData.keyFeatures = extra3;
        break;
      case 'item':
        entityData.type = (type || DEFAULT_ENTITY_TYPE_VALUE) as any;
        entityData.appearance = extra1;
        entityData.history = extra2;
        entityData.abilities = extra3;
        break;
    }

    onSubmit(entityData);
    onOpenChange(false);
  };

  const fieldValues = [extra1, extra2, extra3, extra4];
  const fieldSetters = [setExtra1, setExtra2, setExtra3, setExtra4];
  const currentExtraLabels = extraLabels[entityType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {initialData
                ? `${t.novel.edit} ${currentEntityLabel}`
                : `${t.novel.create} ${currentEntityLabel}`}
            </DialogTitle>
            <DialogDescription>
              {initialData
                ? `${t.novel.update} ${currentEntityLabel}`
                : `${t.novel.add} ${currentEntityLabel}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t.novel.name} *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.novel.namePlaceholder(currentEntityLabel)}
                required
              />
            </div>

            {(entityType === 'setting' || entityType === 'item') && (
              <div className="space-y-2">
                <Label>{t.novel.type}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.novel.selectType} />
                  </SelectTrigger>
                  <SelectContent>
                    {(entityType === 'setting'
                      ? settingTypeOptions
                      : itemTypeOptions
                    ).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t.novel.entityDescription}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.novel.descriptionPlaceholder(currentEntityLabel)}
                rows={3}
              />
            </div>

            {currentExtraLabels.map((label, index) => {
              const value = fieldValues[index];
              const setter = fieldSetters[index];

              return (
                <div key={label} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={t.novel.fieldPlaceholder(label)}
                  />
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.novel.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {initialData ? t.novel.update : t.novel.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
