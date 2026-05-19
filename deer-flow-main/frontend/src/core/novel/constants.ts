export const SETTING_TYPES = ['城市', '建筑', '自然景观', '地区', '其他'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const ITEM_TYPES = ['关键物品', '武器', '科技装置', '普通物品', '其他'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const DEFAULT_SETTING_TYPE: SettingType = '其他';
export const DEFAULT_ITEM_TYPE: ItemType = '其他';
