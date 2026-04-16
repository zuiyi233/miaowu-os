import { useNovelDataSelector } from "../lib/react-query/db-queries";

/**
 * 获取角色提及数据的通用 Hook
 * 遵循 DRY 原则，避免在多个组件中重复相同的逻辑
 * 
 * @param excludeCharacterId 可选参数，用于排除特定角色（如在角色编辑表单中排除自己）
 * @returns 格式化后的角色提及数据数组 { id: string; name: string }[]
 */
export const useMentionItems = (excludeCharacterId?: string) => {
  const characters = useNovelDataSelector((novel) => novel?.characters || []);
  
  return characters.data?.filter(c => !excludeCharacterId || c.id !== excludeCharacterId).map(c => ({ 
    id: c.id, 
    name: c.name 
  })) || [];
};