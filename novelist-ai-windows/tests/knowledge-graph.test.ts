/**
 * 知识图谱功能测试
 * 验证文本分析、关系服务和反向链接功能
 */

import { describe, it, expect, vi } from "vitest";
import { extractMentionedIds, getPlainTextSnippet } from "../lib/utils/text-analysis";
import { relationshipService } from "../services/relationshipService";
import type { Novel } from "../types";

// Mock document for getPlainTextSnippet test
Object.defineProperty(global, "document", {
  value: {
    createElement: vi.fn().mockReturnValue({
      innerHTML: "",
      textContent: "这是一个重要的段落。",
      innerText: "这是一个重要的段落。",
    }),
  },
  writable: true,
});

describe("文本分析工具", () => {
  it("应该正确提取提及的实体ID", () => {
    const htmlContent = `
      <p>这是一个包含<span data-type="mention" class="mention" data-id="char-123">@艾拉</span>的段落。</p>
      <p>还有另一个<span data-type="mention" data-id="setting-456">@魔法森林</span>。</p>
      <p>重复提及<span data-type="mention" data-id="char-123">@艾拉</span>。</p>
    `;

    const ids = extractMentionedIds(htmlContent);
    expect(ids).toEqual(["char-123", "setting-456"]);
  });

  it("应该处理空内容", () => {
    const ids = extractMentionedIds("");
    expect(ids).toEqual([]);
  });

  it("应该处理没有提及的内容", () => {
    const htmlContent = "<p>这是一个普通的段落，没有提及任何实体。</p>";
    const ids = extractMentionedIds(htmlContent);
    expect(ids).toEqual([]);
  });

  it("应该正确获取纯文本摘要", () => {
    const html = "<p>这是一个<strong>重要</strong>的段落。</p>";
    const snippet = getPlainTextSnippet(html, 10);
    expect(snippet).toBe("这是一个重要的...");
  });
});

describe("关系图谱服务", () => {
  const mockNovel: Novel = {
    title: "测试小说",
    outline: "测试大纲",
    chapters: [
      {
        id: "chapter-1",
        title: "第一章",
        content: "<p>在这个章节中，<span data-type=\"mention\" data-id=\"char-123\">@艾拉</span>遇到了<span data-type=\"mention\" data-id=\"setting-456\">@魔法森林</span>。</p>",
      },
      {
        id: "chapter-2",
        title: "第二章",
        content: "<p><span data-type=\"mention\" data-id=\"char-123\">@艾拉</span>继续她的冒险。</p>",
      },
    ],
    characters: [
      {
        id: "char-123",
        name: "艾拉",
        description: "<p>勇敢的冒险者，曾经去过<span data-type=\"mention\" data-id=\"setting-456\">@魔法森林</span>。</p>",
        backstory: "<p>她的故事与<span data-type=\"mention\" data-id=\"faction-789\">@光明议会</span>有关。</p>",
        personality: "",
        motivation: "",
        appearance: "",
      },
      {
        id: "char-456",
        name: "鲍勃",
        description: "<p>普通的村民。</p>",
        backstory: "",
        personality: "",
        motivation: "",
        appearance: "",
      },
    ],
    settings: [
      {
        id: "setting-456",
        name: "魔法森林",
        description: "<p>神秘的森林，<span data-type=\"mention\" data-id=\"char-123\">@艾拉</span>曾经在这里探险。</p>",
        atmosphere: "<p>充满了魔法气息。</p>",
        history: "",
        keyFeatures: "",
      },
    ],
    factions: [
      {
        id: "faction-789",
        name: "光明议会",
        description: "<p>一个神秘的组织，<span data-type=\"mention\" data-id=\"char-123\">@艾拉</span>是其中一员。</p>",
        ideology: "",
        goals: "",
        structure: "",
        resources: "",
        relationships: "",
      },
    ],
    items: [],
  };

  it("应该正确获取角色的反向链接", () => {
    const backlinks = relationshipService.getBacklinks("char-123", mockNovel);
    
    expect(backlinks).toHaveLength(4);
    expect(backlinks.map(link => link.sourceType)).toEqual(
      expect.arrayContaining(["chapter", "chapter", "setting", "faction"])
    );
  });

  it("应该正确获取场景的反向链接", () => {
    const backlinks = relationshipService.getBacklinks("setting-456", mockNovel);
    
    expect(backlinks).toHaveLength(2);
    expect(backlinks[0].sourceType).toBe("chapter");
    expect(backlinks[1].sourceType).toBe("character");
  });

  it("应该处理没有反向链接的情况", () => {
    const backlinks = relationshipService.getBacklinks("char-456", mockNovel);
    expect(backlinks).toEqual([]);
  });

  it("应该处理空小说数据", () => {
    const backlinks = relationshipService.getBacklinks("char-123", null);
    expect(backlinks).toEqual([]);
  });
});