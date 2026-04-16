import { NovelOption } from "../lib/constants/novel-options/types";

export interface TagColorScheme {
  selected: string;
  unselected: string;
  hover: string;
  description: string;
}

/**
 * 标签颜色方案 - 按功能分类着色
 * 基于KISS原则，保持简洁直观的颜色体系
 */
export const TAG_COLOR_SCHEMES: Record<string, TagColorScheme> = {
  // 金手指与系统 - 绿色系 (增长、成功)
  cheat: {
    selected: "bg-green-500 hover:bg-green-600 text-white border-green-600",
    unselected: "bg-green-50 hover:bg-green-100 text-green-800 border-green-300",
    hover: "hover:bg-green-100",
    description: "💰 金手指类型，提供特殊能力或系统支持",
  },
  
  // 剧情模式 - 紫色系 (神秘、变化)
  mode: {
    selected: "bg-purple-500 hover:bg-purple-600 text-white border-purple-600",
    unselected: "bg-purple-50 hover:bg-purple-100 text-purple-800 border-purple-300",
    hover: "hover:bg-purple-100",
    description: "🎭 剧情模式，决定故事走向和核心机制",
  },
  
  // 主角人设 - 蓝色系 (稳定、可靠)
  char: {
    selected: "bg-blue-500 hover:bg-blue-600 text-white border-blue-600",
    unselected: "bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300",
    hover: "hover:bg-blue-100",
    description: "👤 主角性格特点，影响行为方式和人际关系",
  },
  
  // 情感关系 - 红色系 (热情、情感)
  rel: {
    selected: "bg-rose-500 hover:bg-rose-600 text-white border-rose-600",
    unselected: "bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300",
    hover: "hover:bg-rose-100",
    description: "❤️ 情感类型，定义人物之间的情感纽带",
  },
  
  // 修炼流派 - 橙色系 (力量、战斗)
  cultivation: {
    selected: "bg-orange-500 hover:bg-orange-600 text-white border-orange-600",
    unselected: "bg-orange-50 hover:bg-orange-100 text-orange-800 border-orange-300",
    hover: "hover:bg-orange-100",
    description: "⚔️ 修炼体系，决定战斗风格和能力进阶",
  },
  
  // 美学氛围 - 粉色系 (美感、氛围)
  aesthetic: {
    selected: "bg-pink-500 hover:bg-pink-600 text-white border-pink-600",
    unselected: "bg-pink-50 hover:bg-pink-100 text-pink-800 border-pink-300",
    hover: "hover:bg-pink-100",
    description: "🎨 美学风格，营造独特的世界观氛围",
  },
};

/**
 * 获取标签颜色方案
 * @param tagId 标签ID
 * @returns 对应的颜色方案
 */
export function getTagColorScheme(tagId: string): TagColorScheme {
  // 优先匹配具体前缀
  if (tagId.startsWith("cultivation_")) {
    return TAG_COLOR_SCHEMES.cultivation;
  }
  if (tagId.startsWith("aesthetic_")) {
    return TAG_COLOR_SCHEMES.aesthetic;
  }
  
  // 标准前缀匹配
  const prefix = tagId.split("_")[0];
  return TAG_COLOR_SCHEMES[prefix] || TAG_COLOR_SCHEMES.mode;
}

/**
 * 获取标签前缀描述
 * @param tagId 标签ID
 * @returns 前缀类型描述
 */
export function getTagPrefixDescription(tagId: string): string {
  const scheme = getTagColorScheme(tagId);
  return scheme.description;
}

/**
 * 生成标签的动态className
 * @param tagId 标签ID
 * @param isSelected 是否选中
 * @returns 完整的className字符串
 */
export function getTagClassName(tagId: string, isSelected: boolean = false): string {
  const scheme = getTagColorScheme(tagId);
  const baseClasses = "cursor-pointer transition-all px-3 py-1 h-7 select-none border";
  
  if (isSelected) {
    return `${baseClasses} ${scheme.selected}`;
  } else {
    return `${baseClasses} ${scheme.unselected}`;
  }
}

/**
 * 获取所有可用的标签前缀类型
 * @returns 前缀类型数组
 */
export function getAvailableTagPrefixes(): string[] {
  return Object.keys(TAG_COLOR_SCHEMES);
}