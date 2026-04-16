import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractionService } from "../services/extractionService";
import { extractWorldFromOutline } from "../services/llmService";
import { databaseService } from "../lib/storage/db";

// Mock the dependencies
vi.mock("../services/llmService");
vi.mock("../lib/storage/db");

describe("World Extraction Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract world entities from outline text", async () => {
    // Mock the LLM service response
    const mockExtractedData = {
      characters: [
        { name: "李火旺", description: "心素迷惘，分不清现实与幻觉的修仙者" },
        { name: "红中", description: "坐忘道成员，善于欺骗" },
      ],
      factions: [{ name: "坐忘道", description: "以欺骗为乐的邪祟组织" }],
      settings: [{ name: "天庭", description: "仙界统治机构" }],
      items: [{ name: "道袍", description: "修仙者穿的法衣" }],
    };

    vi.mocked(extractWorldFromOutline).mockResolvedValue(mockExtractedData);

    // Mock the database service
    const mockNovel = {
      title: "测试小说",
      characters: [],
      factions: [],
      settings: [],
      items: [],
    };

    vi.mocked(databaseService.loadNovel).mockResolvedValue(mockNovel);
    vi.mocked(databaseService.addCharacter).mockResolvedValue();
    vi.mocked(databaseService.addFaction).mockResolvedValue();
    vi.mocked(databaseService.addSetting).mockResolvedValue();
    vi.mocked(databaseService.addItem).mockResolvedValue();

    // Test the extraction
    const outlineText =
      "卷一：开始\n李火旺是一个修仙者，他遇到了坐忘道的红中。故事发生天庭，他穿着道袍。";
    const novelTitle = "测试小说";

    const stats = await extractionService.extractAndSave(
      outlineText,
      novelTitle
    );

    // Verify the results
    expect(stats).toEqual({
      chars: 2,
      factions: 1,
      settings: 1,
      items: 1,
    });

    // Verify the LLM service was called
    expect(extractWorldFromOutline).toHaveBeenCalledWith(outlineText);

    // Verify database operations
    expect(databaseService.loadNovel).toHaveBeenCalledWith(novelTitle);
    expect(databaseService.addCharacter).toHaveBeenCalledTimes(2);
    expect(databaseService.addFaction).toHaveBeenCalledTimes(1);
    expect(databaseService.addSetting).toHaveBeenCalledTimes(1);
    expect(databaseService.addItem).toHaveBeenCalledTimes(1);
  });

  it("should handle empty outline text", async () => {
    await expect(
      extractionService.extractAndSave("", "测试小说")
    ).rejects.toThrow("大纲内容太少，无法提取");
  });

  it("should handle novel not found", async () => {
    vi.mocked(databaseService.loadNovel).mockResolvedValue(null);

    await expect(
      extractionService.extractAndSave(
        "这是一个足够长的大纲内容，用于测试小说不存在的情况",
        "不存在的小说"
      )
    ).rejects.toThrow("找不到当前小说");
  });

  it("should avoid duplicate entities", async () => {
    const mockExtractedData = {
      characters: [{ name: "李火旺", description: "心素迷惘的修仙者" }],
      factions: [],
      settings: [],
      items: [],
    };

    vi.mocked(extractWorldFromOutline).mockResolvedValue(mockExtractedData);

    const mockNovel = {
      title: "测试小说",
      characters: [
        { id: "char-1", name: "李火旺", description: "已存在的角色" },
      ],
      factions: [],
      settings: [],
      items: [],
    };

    vi.mocked(databaseService.loadNovel).mockResolvedValue(mockNovel);
    vi.mocked(databaseService.addCharacter).mockResolvedValue();

    const stats = await extractionService.extractAndSave(
      "这是一个足够长的大纲内容，用于测试避免重复实体的情况",
      "测试小说"
    );

    expect(stats.chars).toBe(0); // Should not add duplicate
    expect(databaseService.addCharacter).not.toHaveBeenCalled();
  });
});
