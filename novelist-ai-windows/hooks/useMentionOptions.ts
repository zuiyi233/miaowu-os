import { useNovelDataSelector } from "@/lib/react-query/db-queries";
import { 
  User,       // 角色
  MapPin,     // 场景
  Shield,     // 势力
  Gem,        // 物品
  LucideIcon 
} from "lucide-react";

export type MentionType = 'character' | 'setting' | 'faction' | 'item';

export interface MentionOption {
  id: string;
  label: string;
  type: MentionType;
  icon: LucideIcon;
}

/**
 * 统一的提及选项 Hook
 * 遵循 DRY 原则，聚合所有实体类型数据，避免在多个组件中重复相同的逻辑
 * 
 * @param excludeCharacterId 可选参数，用于排除特定角色（如在角色编辑表单中排除自己）
 * @returns 包含所有实体类型的提及选项数组
 */
export const useMentionOptions = (excludeCharacterId?: string): MentionOption[] => {
  // 使用 Selector 获取所有数据
  const novelData = useNovelDataSelector((data) => data);

  if (!novelData.data) return [];

  const { characters, settings, factions, items } = novelData.data;

  // 1. 角色
  const charOptions: MentionOption[] = (characters || [])
    .filter(c => !excludeCharacterId || c.id !== excludeCharacterId)
    .map(c => ({
    id: c.id,
    label: c.name,
    type: 'character' as MentionType,
    icon: User
  }));

  // 2. 场景
  const settingOptions: MentionOption[] = (settings || []).map(s => ({
    id: s.id,
    label: s.name,
    type: 'setting' as MentionType,
    icon: MapPin
  }));

  // 3. 势力
  const factionOptions: MentionOption[] = (factions || []).map(f => ({
    id: f.id,
    label: f.name,
    type: 'faction' as MentionType,
    icon: Shield
  }));

  // 4. 物品
  const itemOptions: MentionOption[] = (items || []).map(i => ({
    id: i.id,
    label: i.name,
    type: 'item' as MentionType,
    icon: Gem
  }));

  // 合并所有选项
  return [...charOptions, ...settingOptions, ...factionOptions, ...itemOptions];
};