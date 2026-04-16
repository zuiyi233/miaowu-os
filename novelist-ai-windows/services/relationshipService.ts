import type { Novel } from "../types";
import { extractMentionedIds } from "../lib/utils/text-analysis";

export interface Backlink {
  sourceId: string;
  sourceTitle: string;
  sourceType: "chapter" | "character" | "setting" | "faction" | "item";
  contextSnippet?: string; // 可选：提及时的上下文片段
}

/**
 * 关系图谱服务
 * 负责计算实体之间的引用关系
 */
export const relationshipService = {
  /**
   * 获取指向特定实体的所有反向链接
   * @param targetId 目标实体 ID (例如当前查看的角色 ID)
   * @param novel 完整的小说数据
   */
  getBacklinks(targetId: string, novel: Novel | null | undefined): Backlink[] {
    if (!novel || !targetId) return [];

    const backlinks: Backlink[] = [];

    // 1. 检查章节 (Chapters)
    novel.chapters?.forEach((chapter) => {
      const mentionedIds = extractMentionedIds(chapter.content || "");
      if (mentionedIds.includes(targetId)) {
        backlinks.push({
          sourceId: chapter.id,
          sourceTitle: chapter.title,
          sourceType: "chapter",
        });
      }
    });

    // 2. 检查其他角色 (Characters) - 例如：A 的背景故事里提到了 B
    novel.characters?.forEach((char) => {
      if (char.id === targetId) return; // 排除自己
      
      // 检查所有富文本字段
      const content = [
        char.description, 
        char.backstory, 
        char.personality, 
        char.motivation,
        char.appearance
      ].join(" ");

      const mentionedIds = extractMentionedIds(content);
      if (mentionedIds.includes(targetId)) {
        backlinks.push({
          sourceId: char.id,
          sourceTitle: char.name,
          sourceType: "character",
        });
      }
    });

    // 3. 检查场景 (Settings)
    novel.settings?.forEach((setting) => {
      const content = [
        setting.description,
        setting.atmosphere,
        setting.history,
        setting.keyFeatures
      ].join(" ");

      const mentionedIds = extractMentionedIds(content);
      if (mentionedIds.includes(targetId)) {
        backlinks.push({
          sourceId: setting.id,
          sourceTitle: setting.name,
          sourceType: "setting",
        });
      }
    });

    // 4. 检查势力 (Factions)
    novel.factions?.forEach((faction) => {
      const content = [
        faction.description,
        faction.ideology,
        faction.goals,
        faction.structure,
        faction.resources,
        faction.relationships
      ].join(" ");
      
      const mentionedIds = extractMentionedIds(content);
      if (mentionedIds.includes(targetId)) {
        backlinks.push({
          sourceId: faction.id,
          sourceTitle: faction.name,
          sourceType: "faction",
        });
      }
    });

    // 5. 检查物品 (Items)
    novel.items?.forEach((item) => {
      const content = [
        item.description,
        item.appearance,
        item.history,
        item.abilities
      ].join(" ");

      const mentionedIds = extractMentionedIds(content);
      if (mentionedIds.includes(targetId)) {
        backlinks.push({
          sourceId: item.id,
          sourceTitle: item.name,
          sourceType: "item",
        });
      }
    });

    return backlinks;
  }
};