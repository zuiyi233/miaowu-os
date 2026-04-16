/**
 * 世界构建模块集成测试
 * 遵循单一职责原则，专注于世界构建功能的集成测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import { contextEngineService } from "../services/contextEngineService";
import { databaseService } from "../lib/storage/db";
import type { Faction, Character, Setting } from "../types";

describe("世界构建模块集成测试", () => {
  let testNovel: any;

  beforeEach(async () => {
    // 初始化测试数据
    testNovel = {
      title: "Test Novel",
      outline: "Test outline",
      volumes: [],
      chapters: [],
      characters: [
        {
          id: "char1",
          name: "艾拉",
          description:
            "一位年轻的密码学家，戴着黄铜边框的眼镜，沉着冷静但对古老技术充满好奇。",
        },
        {
          id: "char2",
          name: "老亨利",
          description: "经验丰富的机械师，对蒸汽技术了如指掌。",
        },
      ],
      settings: [
        {
          id: "setting1",
          name: "黄昏酒馆",
          description:
            "位于城市蒸汽管道区的地下酒馆，光线昏暗，空气中弥漫着煤灰和劣质酒精的味道。",
        },
      ],
      factions: [
        {
          id: "faction1",
          name: "铁锤兄弟会",
          description:
            '一个信奉力量至上的工人阶级帮派，鄙视"不劳而获"的知识分子和贵族。',
          ideology: "力量至上，劳动光荣",
          leaderId: "char2",
        },
      ],
    };

    // 保存测试数据
    await databaseService.saveNovel(testNovel);
  });

  describe("ContextEngine 服务测试", () => {
    it("应该正确解析实体引用", () => {
      const input = "写一段 @艾拉 在 #黄昏酒馆 遇到 ~铁锤兄弟会~ 的冲突场景";
      const entities = contextEngineService.parseEntities(input);

      expect(entities.characters).toContain("艾拉");
      expect(entities.settings).toContain("黄昏酒馆");
      expect(entities.factions).toContain("铁锤兄弟会");
    });

    it("应该正确检索角色数据", async () => {
      const entities = { characters: ["艾拉"], settings: [], factions: [] };
      const contextData = await contextEngineService.retrieveContext(entities);

      expect(contextData.characterData).toBeDefined();
      expect(contextData.characterData?.name).toBe("艾拉");
      expect(contextData.characterData?.description).toContain("密码学家");
    });

    it("应该正确检索场景数据", async () => {
      const entities = { characters: [], settings: ["黄昏酒馆"], factions: [] };
      const contextData = await contextEngineService.retrieveContext(entities);

      expect(contextData.settingData).toBeDefined();
      expect(contextData.settingData?.name).toBe("黄昏酒馆");
      expect(contextData.settingData?.description).toContain("地下酒馆");
    });

    it("应该正确检索势力数据", async () => {
      const entities = {
        characters: [],
        settings: [],
        factions: ["铁锤兄弟会"],
      };
      const contextData = await contextEngineService.retrieveContext(entities);

      expect(contextData.factionData).toBeDefined();
      expect(contextData.factionData?.name).toBe("铁锤兄弟会");
      expect(contextData.factionData?.ideology).toBe("力量至上，劳动光荣");
    });

    it("应该组装格式化的上下文", async () => {
      const entities = {
        characters: ["艾拉"],
        settings: ["黄昏酒馆"],
        factions: ["铁锤兄弟会"],
      };
      const contextData = await contextEngineService.retrieveContext(entities);
      const context = contextEngineService.assembleContext(contextData);

      expect(context).toContain("--- 上下文开始 ---");
      expect(context).toContain("**[角色]**");
      expect(context).toContain("**[场景]**");
      expect(context).toContain("**[势力]**");
      expect(context).toContain("艾拉");
      expect(context).toContain("黄昏酒馆");
      expect(context).toContain("铁锤兄弟会");
    });

    it("应该构建增强的提示词", async () => {
      const userInput = "写一段 @艾拉 在 #黄昏酒馆 的场景";
      const enhancedPrompt = await contextEngineService.enhancePrompt(
        userInput
      );

      expect(enhancedPrompt).toContain("--- 上下文开始 ---");
      expect(enhancedPrompt).toContain("用户请求");
      expect(enhancedPrompt).toContain("艾拉");
      expect(enhancedPrompt).toContain("黄昏酒馆");
    });

    it("应该检查内容一致性", async () => {
      const entities = { characters: ["艾拉"], settings: [], factions: [] };
      const content = "这是关于艾拉的故事内容";
      const result = await contextEngineService.checkConsistency(
        content,
        entities
      );

      expect(result.isConsistent).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("应该检测不一致的内容", async () => {
      const entities = { characters: ["艾拉"], settings: [], factions: [] };
      const content = "这是关于其他角色的故事内容";
      const result = await contextEngineService.checkConsistency(
        content,
        entities
      );

      expect(result.isConsistent).toBe(false);
      expect(result.issues).toContain('内容中未提及角色 "艾拉"');
    });
  });

  describe("数据库集成测试", () => {
    it("应该正确保存和加载势力数据", async () => {
      const novel = await databaseService.loadNovel("Test Novel");

      expect(novel).toBeDefined();
      expect(novel?.factions).toHaveLength(1);
      expect(novel?.factions[0].name).toBe("铁锤兄弟会");
      expect(novel?.factions[0].ideology).toBe("力量至上，劳动光荣");
    });

    it("应该正确保存和加载完整的小说数据", async () => {
      const novel = await databaseService.loadNovel("Test Novel");

      expect(novel).toBeDefined();
      expect(novel?.characters).toHaveLength(2);
      expect(novel?.settings).toHaveLength(1);
      expect(novel?.factions).toHaveLength(1);
    });
  });

  describe("类型安全测试", () => {
    it("Faction 类型应该包含所有必需字段", () => {
      const faction: Faction = {
        id: "test-faction",
        name: "测试势力",
        description: "测试描述",
        ideology: "测试理念",
        leaderId: "test-leader",
      };

      expect(faction.id).toBe("test-faction");
      expect(faction.name).toBe("测试势力");
      expect(faction.description).toBe("测试描述");
      expect(faction.ideology).toBe("测试理念");
      expect(faction.leaderId).toBe("test-leader");
    });
  });
});
