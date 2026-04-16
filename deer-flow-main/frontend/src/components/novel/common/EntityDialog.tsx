'use client';

import { useState, useEffect } from 'react';
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
import type { Character, Faction, Setting, Item } from '@/core/novel/schemas';

interface EntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  entityType: 'character' | 'faction' | 'setting' | 'item';
  initialData?: Character | Faction | Setting | Item | null;
  novelId: string;
}

export function EntityDialog({ open, onOpenChange, onSubmit, entityType, initialData, novelId }: EntityDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [extra1, setExtra1] = useState('');
  const [extra2, setExtra2] = useState('');
  const [extra3, setExtra3] = useState('');
  const [extra4, setExtra4] = useState('');

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setDescription(initialData.description || '');
      setType('type' in initialData ? (initialData as any).type : '');
    } else {
      setName('');
      setDescription('');
      setType('');
      setExtra1('');
      setExtra2('');
      setExtra3('');
      setExtra4('');
    }
  }, [initialData, open]);

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
        entityData.type = (type || '其他') as any;
        entityData.atmosphere = extra1;
        entityData.history = extra2;
        entityData.keyFeatures = extra3;
        break;
      case 'item':
        entityData.type = (type || '其他') as any;
        entityData.appearance = extra1;
        entityData.history = extra2;
        entityData.abilities = extra3;
        break;
    }

    onSubmit(entityData);
    onOpenChange(false);
  };

  const getTitle = () => {
    switch (entityType) {
      case 'character': return initialData ? 'Edit Character' : 'Create Character';
      case 'faction': return initialData ? 'Edit Faction' : 'Create Faction';
      case 'setting': return initialData ? 'Edit Setting' : 'Create Setting';
      case 'item': return initialData ? 'Edit Item' : 'Create Item';
    }
  };

  const getExtraLabels = () => {
    switch (entityType) {
      case 'character':
        return ['Age', 'Gender', 'Appearance', 'Personality'];
      case 'faction':
        return ['Ideology', 'Goals', 'Structure', 'Resources'];
      case 'setting':
        return ['Atmosphere', 'History', 'Key Features', ''];
      case 'item':
        return ['Appearance', 'History', 'Abilities', ''];
    }
  };

  const labels = getExtraLabels();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{getTitle()}</DialogTitle>
            <DialogDescription>
              {initialData ? 'Update the information' : 'Add new'} {entityType}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Enter ${entityType} name...`}
                required
              />
            </div>

            {(entityType === 'setting' || entityType === 'item') && (
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {entityType === 'setting' ? (
                      <>
                        <SelectItem value="城市">城市</SelectItem>
                        <SelectItem value="建筑">建筑</SelectItem>
                        <SelectItem value="自然景观">自然景观</SelectItem>
                        <SelectItem value="地区">地区</SelectItem>
                        <SelectItem value="其他">其他</SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="关键物品">关键物品</SelectItem>
                        <SelectItem value="武器">武器</SelectItem>
                        <SelectItem value="科技装置">科技装置</SelectItem>
                        <SelectItem value="普通物品">普通物品</SelectItem>
                        <SelectItem value="其他">其他</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`Describe the ${entityType}...`}
                rows={3}
              />
            </div>

            {labels.map((label, i) => {
              const value = [extra1, extra2, extra3, extra4][i];
              const setter = [setExtra1, setExtra2, setExtra3, setExtra4][i];
              return label && setter && (
                <div key={i} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={`Enter ${label.toLowerCase()}...`}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {initialData ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
