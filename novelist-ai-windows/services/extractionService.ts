import { databaseService } from "../lib/storage/db";
import { extractWorldFromOutline } from "./llmService";
import { generateUniqueId } from "../lib/utils/id";
import { toast } from "sonner";

export const extractionService = {
  /**
   * 执行提取并保存流程
   * @param outlineText 大纲文本
   * @param novelTitle 当前小说标题
   */
  async extractAndSave(outlineText: string, novelTitle: string) {
    if (!outlineText || outlineText.length < 10) {
      throw new Error("大纲内容太少，无法提取");
    }

    // 1. 调用 AI 提取
    const data = await extractWorldFromOutline(outlineText);

    // 2. 准备统计数据
    const stats = { chars: 0, factions: 0, settings: 0, items: 0 };

    // 3. 批量处理与去重逻辑
    // 我们需要先加载现有数据，避免创建同名实体
    const currentNovel = await databaseService.loadNovel(novelTitle);
    if (!currentNovel) throw new Error("找不到当前小说");

    const existingCharNames = new Set(
      currentNovel.characters?.map((c) => c.name)
    );
    const existingFactionNames = new Set(
      currentNovel.factions?.map((f) => f.name)
    );
    const existingSettingNames = new Set(
      currentNovel.settings?.map((s) => s.name)
    );
    const existingItemNames = new Set(currentNovel.items?.map((i) => i.name));

    // --- 处理角色 ---
    if (data.characters && Array.isArray(data.characters)) {
      for (const char of data.characters) {
        if (!existingCharNames.has(char.name)) {
          await databaseService.addCharacter(
            {
              id: generateUniqueId("char"),
              name: char.name,
              description: char.description,
              novelId: novelTitle,
            },
            novelTitle
          );
          stats.chars++;
        }
      }
    }

    // --- 处理势力 ---
    if (data.factions && Array.isArray(data.factions)) {
      for (const fac of data.factions) {
        if (!existingFactionNames.has(fac.name)) {
          await databaseService.addFaction(
            {
              id: generateUniqueId("fac"),
              name: fac.name,
              description: fac.description,
              novelId: novelTitle,
            },
            novelTitle
          );
          stats.factions++;
        }
      }
    }

    // --- 处理场景 ---
    if (data.settings && Array.isArray(data.settings)) {
      for (const place of data.settings) {
        if (!existingSettingNames.has(place.name)) {
          await databaseService.addSetting(
            {
              id: generateUniqueId("set"),
              name: place.name,
              description: place.description,
              type: "其他", // 设置默认类型
              novelId: novelTitle,
            },
            novelTitle
          );
          stats.settings++;
        }
      }
    }

    // --- 处理物品 ---
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!existingItemNames.has(item.name)) {
          await databaseService.addItem(
            {
              id: generateUniqueId("item"),
              name: item.name,
              description: item.description,
              type: "其他", // 设置默认类型
              novelId: novelTitle,
            },
            novelTitle
          );
          stats.items++;
        }
      }
    }

    return stats;
  },
};
