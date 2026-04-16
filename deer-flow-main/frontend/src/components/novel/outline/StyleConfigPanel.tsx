'use client';

import React from 'react';
import { useOutlineStore } from '@/core/novel/useOutlineStore';
import { useStyleStore } from '@/core/novel/useStyleStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const StyleConfigPanel: React.FC = () => {
  const { activeStyleId, setActiveStyleId, styles } = useStyleStore();

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label>当前文风</Label>
        <Select value={activeStyleId} onValueChange={setActiveStyleId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {styles.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {styles.find((s) => s.id === activeStyleId) && (
        <div>
          <Label>文风描述</Label>
          <p className="text-sm text-muted-foreground mt-1">
            {styles.find((s) => s.id === activeStyleId)?.description}
          </p>
        </div>
      )}
    </div>
  );
};
