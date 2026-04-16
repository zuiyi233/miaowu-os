import { databaseService } from "../lib/storage/db";
import type {
  Novel,
  Character,
  Setting,
  Faction,
  Item,
  EntityRelationship,
} from "../types";
import { relationshipService, type Backlink } from "./relationshipService";
import {
  getPlainTextSnippet,
  extractChapterGoal,
  cleanNovelContent,
} from "../lib/utils/text-analysis";
import { estimateTokens } from "../lib/utils/token";
import { useUiStore } from "../stores/useUiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
// ✅ 1. 引入必要依赖
import { getModelSpec } from "../src/lib/constants/modelSpecs";
// ✅ 新增：引入增强的Embedding服务
import { embeddingService } from "./embeddingService";
// ✅ 新增：引入文风注入服务
import { styleInjectionService } from "./styleInjectionService";
import { logger } from "../lib/logging";

// 上下文选项接口
export interface ContextAnalysisOptions {
  includeWorld?: boolean;
  includeChapter?: boolean; // 包含章节正文+细纲
  includeOutline?: boolean;
}

// ✅ 定义统计数据接口
export interface ContextStats {
  totalCharacters: number; // 总上下文长度
  previousChaptersCount: number; // 包含了前几章原文
  previousChaptersRange?: string; // 章节范围，如 "5-9"
  includesSummary: boolean; // 是否包含全书摘要
  includesStyle: boolean; // 是否包含文风协议
  includesRAG: boolean; // 是否包含 RAG 实体
}

/**
 * 提示词变量注入接口
 * 定义可注入的变量类型和值
 */
interface PromptVariables {
  selection?: string;
  input?: string;
  context?: string;
  [key: string]: string | undefined;
}

/**
 * 解析后的实体接口
 * 遵循单一职责原则，定义解析结果的数据结构
 */
interface ParsedEntities {
  characters: string[];
  settings: string[];
  factions: string[];
  items: string[]; // 新增物品支持
}

/**
 * 实体节点接口
 * 遵循单一职责原则，定义实体节点的数据结构
 */
interface EntityNode {
  id: string;
  type: "character" | "setting" | "faction" | "item";
  name: string;
  description: string;
  // 特定类型的额外属性
  factionId?: string; // 角色所属势力
  ownerId?: string; // 物品持有者
  leaderId?: string; // 势力领导者
}

/**
 * 关系边接口
 * 遵循单一职责原则，定义关系边的数据结构
 */
interface RelationEdge {
  source: string; // 源实体名称
  target: string; // 目标实体名称
  type:
    | "mention"
    | "ownership"
    | "leadership"
    | "membership"
    | "friend"
    | "enemy"
    | "family"
    | "lover"
    | "custom";
  context: string; // 关系上下文
}

/**
 * 增强版上下文数据接口
 * 遵循单一职责原则，定义关系图谱结构
 */
interface EnhancedContextData {
  nodes: EntityNode[]; // 实体节点
  edges: RelationEdge[]; // 关系边
}

// 保持向后兼容的旧接口
interface ContextData {
  characterData?: Character;
  settingData?: Setting;
  factionData?: Faction;
  itemData?: Item; // 新增物品数据
}

// 定义一个带权重的上下文块
interface ContextBlock {
  priority: number; // 权重：越高越重要
  content: string;
  tokens: number; // 估算长度
  type: string; // 类型标识，用于日志
  entityId?: string; // 实体ID，用于追踪
}

/**
 * 上下文引擎服务类
 * 遵循单一职责原则，专注于RAG（检索增强生成）功能
 * 实现世界构建数据的智能上下文注入
 */
export class ContextEngineService {
  /**
   * 实体索引缓存
   * 遵循性能优化原则，缓存实体名称映射以提升解析性能
   */
  private entityCache: {
    timestamp: number;
    names: Map<string, { id: string; type: string }>; // name -> metadata
  } | null = null;

  // 缓存失效时间：1分钟，或者在 entity mutation 时手动清除
  private readonly CACHE_TTL = 60 * 1000;

  /**
   * 获取实体名称映射索引
   * 遵循单一职责原则，专注于构建高效的实体索引
   */
  private async getEntityMap(): Promise<
    Map<string, { id: string; type: string }>
  > {
    const now = Date.now();

    // 简单的缓存策略：如果缓存存在且未过期，直接返回
    if (this.entityCache && now - this.entityCache.timestamp < this.CACHE_TTL) {
      return this.entityCache.names;
    }

    // 重新构建索引
    const novel = await databaseService.loadNovel(
      useUiStore.getState().currentNovelTitle
    );
    const map = new Map<string, { id: string; type: string }>();

    if (novel) {
      // 构建角色名称索引
      novel.characters?.forEach((char) => {
        map.set(char.name.toLowerCase(), { id: char.id, type: "character" });
      });

      // 构建场景名称索引
      novel.settings?.forEach((setting) => {
        map.set(setting.name.toLowerCase(), {
          id: setting.id,
          type: "setting",
        });
      });

      // 构建势力名称索引
      novel.factions?.forEach((faction) => {
        map.set(faction.name.toLowerCase(), {
          id: faction.id,
          type: "faction",
        });
      });

      // 构建物品名称索引
      novel.items?.forEach((item) => {
        map.set(item.name.toLowerCase(), { id: item.id, type: "item" });
      });
    }

    // 更新缓存
    this.entityCache = { timestamp: now, names: map };
    return map;
  }

  /**
   * 清除实体缓存
   * 遵循数据一致性原则，在实体变更时清除缓存
   */
  public clearEntityCache(): void {
    this.entityCache = null;
  }

  /**
   * 解析用户输入中的实体引用
   * 使用正则表达式识别 @角色、#场景、~势力~、$物品$ 语法
   * 遵循单一职责原则，专注于实体解析逻辑
   */
  parseEntities(input: string): ParsedEntities {
    const entities: ParsedEntities = {
      characters: [],
      settings: [],
      factions: [],
      items: [],
    };

    // 解析角色引用 @角色名
    // 使用 [^@#~$\s]+ 匹配非分隔符和空白的任意字符，以支持中文
    const characterMatches = input.match(/@([^@#~$\s]+)/g);
    if (characterMatches) {
      entities.characters = characterMatches.map((match) => match.slice(1));
    }

    // 解析场景引用 #场景名
    const settingMatches = input.match(/#([^@#~$\s]+)/g);
    if (settingMatches) {
      entities.settings = settingMatches.map((match) => match.slice(1));
    }

    // 解析势力引用 ~势力名~
    const factionMatches = input.match(/~([^@#~$\s]+)~/g);
    if (factionMatches) {
      entities.factions = factionMatches.map((match) => match.slice(1, -1));
    }

    // 解析物品引用 $物品名$
    const itemMatches = input.match(/\$([^@#~$\s]+)\$/g);
    if (itemMatches) {
      entities.items = itemMatches.map((match) => match.slice(1, -1));
    }

    return entities;
  }

  /**
   * 智能实体解析 - 从全库中模糊匹配实体名称
   * 遵循开放封闭原则，支持直接提及实体名称而不仅限于语法标记
   * 遵循性能优化原则，使用索引缓存提升解析性能
   */
  async intelligentEntityParsing(userInput: string): Promise<ParsedEntities> {
    const entities: ParsedEntities = {
      characters: [],
      settings: [],
      factions: [],
      items: [],
    };

    // 1. 首先解析语法标记 (@角色、#场景等)
    const markedEntities = this.parseEntities(userInput);

    // 2. 使用优化的索引进行模糊匹配
    const entityMap = await this.getEntityMap();
    const inputLower = userInput.toLowerCase();
    const markedNames = new Set([
      ...markedEntities.characters,
      ...markedEntities.settings,
      ...markedEntities.factions,
      ...markedEntities.items,
    ]);

    // 优化：遍历索引而非遍历所有实体，性能从 O(N*M) 提升到 O(N+M)
    for (const [name, meta] of entityMap.entries()) {
      if (inputLower.includes(name) && !markedNames.has(name)) {
        // 根据实体类型推入对应的数组
        switch (meta.type) {
          case "character":
            entities.characters.push(name);
            break;
          case "setting":
            entities.settings.push(name);
            break;
          case "faction":
            entities.factions.push(name);
            break;
          case "item":
            entities.items.push(name);
            break;
        }
      }
    }

    // 3. 合并语法标记和模糊匹配的结果
    entities.characters.push(...markedEntities.characters);
    entities.settings.push(...markedEntities.settings);
    entities.factions.push(...markedEntities.factions);
    entities.items.push(...markedEntities.items);

    // 4. 去重
    entities.characters = [...new Set(entities.characters)];
    entities.settings = [...new Set(entities.settings)];
    entities.factions = [...new Set(entities.factions)];
    entities.items = [...new Set(entities.items)];

    return entities;
  }

  /**
   * 从数据库检索相关实体数据
   * 遵循单一职责原则，专注于数据检索逻辑
   * 保持向后兼容性
   */
  async retrieveContext(entities: ParsedEntities): Promise<ContextData> {
    const novel = await databaseService.loadNovel(
      useUiStore.getState().currentNovelTitle
    );
    if (!novel) {
      return {};
    }

    const contextData: ContextData = {};

    // 检索角色数据
    if (entities.characters.length > 0) {
      const characterName = entities.characters[0]; // 目前只支持单个角色
      contextData.characterData = novel.characters?.find(
        (char) => char.name === characterName
      );
    }

    // 检索场景数据
    if (entities.settings.length > 0) {
      const settingName = entities.settings[0]; // 目前只支持单个场景
      contextData.settingData = novel.settings?.find(
        (setting) => setting.name === settingName
      );
    }

    // 检索势力数据
    if (entities.factions.length > 0) {
      const factionName = entities.factions[0]; // 目前只支持单个势力
      contextData.factionData = (novel.factions || []).find(
        (faction) => faction.name === factionName
      );
    }

    // 检索物品数据
    if (entities.items.length > 0) {
      const itemName = entities.items[0]; // 目前只支持单个物品
      contextData.itemData = (novel.items || []).find(
        (item) => item.name === itemName
      );
    }

    return contextData;
  }

  /**
   * 增强版上下文检索 - 包含关系网
   * 遵循单一职责原则，专注于关系感知的数据检索逻辑
   */
  async retrieveEnhancedContext(
    entities: ParsedEntities
  ): Promise<EnhancedContextData> {
    const novel = await databaseService.loadNovel(
      useUiStore.getState().currentNovelTitle
    );
    if (!novel) {
      return { nodes: [], edges: [] };
    }

    const contextData: EnhancedContextData = {
      nodes: [],
      edges: [],
    };

    // 辅助函数：添加实体及其关系到上下文
    const addEntityToContext = async (
      entity: any,
      type: "character" | "setting" | "faction" | "item"
    ) => {
      if (!entity) return;

      // 1. 添加基本信息节点
      const node: EntityNode = {
        id: entity.id,
        type,
        name: entity.name,
        description: getPlainTextSnippet(entity.description || ""),
      };

      // 2. 添加特定类型的额外属性
      if (type === "character") {
        node.factionId = entity.factionId;
      } else if (type === "item") {
        node.ownerId = entity.ownerId;
      } else if (type === "faction") {
        node.leaderId = entity.leaderId;
      }

      contextData.nodes.push(node);

      // 3. 🔥 查找该实体的反向链接 (谁提到了它)
      const backlinks = relationshipService.getBacklinks(entity.id, novel);
      if (backlinks.length > 0) {
        backlinks.forEach((backlink) => {
          contextData.edges.push({
            source: entity.name,
            target: backlink.sourceTitle,
            type: "mention",
            context: `在${backlink.sourceType}中被提及`,
          });
        });
      }

      // 4. 🔥 查找显式关系表中的关系
      const relationships = await databaseService.getRelationshipsByEntity(
        entity.id
      );
      if (relationships.length > 0) {
        relationships.forEach((rel) => {
          // 确定关系的方向和目标实体名称
          let targetEntityName = "";
          let relationType = rel.type;

          if (rel.sourceId === entity.id) {
            // 当前实体是源，查找目标实体名称
            const targetEntity = this.findEntityById(rel.targetId, novel);
            if (targetEntity) {
              targetEntityName = targetEntity.name;
            }
          } else {
            // 当前实体是目标，查找源实体名称
            const sourceEntity = this.findEntityById(rel.sourceId, novel);
            if (sourceEntity) {
              targetEntityName = sourceEntity.name;
              // 反转关系类型
              relationType = this.getReverseRelationType(rel.type) as
                | "custom"
                | "friend"
                | "enemy"
                | "family"
                | "lover";
            }
          }

          if (targetEntityName) {
            contextData.edges.push({
              source: entity.name,
              target: targetEntityName,
              type: relationType as any,
              context:
                rel.description || `${this.getRelationLabel(rel.type)}关系`,
            });
          }
        });
      }

      // 4. 添加硬关联关系 (Schema 里的字段)
      if (type === "character" && entity.factionId) {
        const faction = novel.factions?.find((f) => f.id === entity.factionId);
        if (faction) {
          contextData.edges.push({
            source: entity.name,
            target: faction.name,
            type: "membership",
            context: "角色所属势力",
          });
        }
      }

      if (type === "item" && entity.ownerId) {
        const owner = novel.characters?.find((c) => c.id === entity.ownerId);
        if (owner) {
          contextData.edges.push({
            source: entity.name,
            target: owner.name,
            type: "ownership",
            context: "物品持有者",
          });
        }
      }

      if (type === "faction" && entity.leaderId) {
        const leader = novel.characters?.find((c) => c.id === entity.leaderId);
        if (leader) {
          contextData.edges.push({
            source: entity.name,
            target: leader.name,
            type: "leadership",
            context: "势力领导者",
          });
        }
      }
    };

    // 遍历所有解析出的实体名称
    await Promise.all([
      ...entities.characters.map((name) =>
        addEntityToContext(
          novel.characters?.find((c) => c.name === name),
          "character"
        )
      ),
      ...entities.settings.map((name) =>
        addEntityToContext(
          novel.settings?.find((s) => s.name === name),
          "setting"
        )
      ),
      ...entities.factions.map((name) =>
        addEntityToContext(
          novel.factions?.find((f) => f.name === name),
          "faction"
        )
      ),
      ...entities.items.map((name) =>
        addEntityToContext(
          novel.items?.find((i) => i.name === name),
          "item"
        )
      ),
    ]);

    return contextData;
  }

  /**
   * 将检索到的数据组装成格式化的上下文块
   * 遵循单一职责原则，专注于上下文格式化逻辑
   * 保持向后兼容性
   */
  assembleContext(contextData: ContextData): string {
    const contextBlocks: string[] = [];

    // 添加角色信息
    if (contextData.characterData) {
      const character = contextData.characterData;
      contextBlocks.push(`**[角色]**
- **名称**: ${character.name}
- **描述**: ${character.description || "暂无描述"}`);
    }

    // 添加场景信息
    if (contextData.settingData) {
      const setting = contextData.settingData;
      contextBlocks.push(`**[场景]**
- **名称**: ${setting.name}
- **描述**: ${setting.description || "暂无描述"}`);
    }

    // 添加势力信息
    if (contextData.factionData) {
      const faction = contextData.factionData;
      contextBlocks.push(`**[势力]**
- **名称**: ${faction.name}
- **理念**: ${faction.ideology || "暂无理念"}
- **描述**: ${faction.description || "暂无描述"}`);
    }

    // 添加物品信息
    if (contextData.itemData) {
      const item = contextData.itemData;
      contextBlocks.push(`**[物品]**
- **名称**: ${item.name}
- **类型**: ${item.type || "未分类"}
- **描述**: ${item.description || "暂无描述"}`);
    }

    if (contextBlocks.length === 0) {
      return "";
    }

    return `--- 上下文开始 ---
以下是与你创作场景相关的世界构建信息，请确保内容的一致性和准确性：

${contextBlocks.join("\n\n")}

--- 上下文结束 ---`;
  }

  /**
   * 增强版上下文组装 - 包含关系信息
   * 遵循单一职责原则，专注于关系感知的上下文格式化逻辑
   */
  assembleEnhancedContext(contextData: EnhancedContextData): string {
    if (!contextData.nodes || contextData.nodes.length === 0) {
      return "";
    }

    let prompt = "--- 🌍 世界观上下文 (Knowledge Graph) ---\n";

    // 1. 实体定义
    prompt += "【相关实体】\n";
    contextData.nodes.forEach((node: EntityNode) => {
      prompt += `- [${this.getEntityTypeLabel(node.type)}] ${node.name}: ${
        node.description
      }\n`;

      // 注入硬关联 (Schema 里的字段)
      if (node.leaderId) {
        const leaderNode = contextData.nodes.find(
          (n) => n.id === node.leaderId
        );
        if (leaderNode) prompt += `  (领导者: ${leaderNode.name})\n`;
      }
      if (node.ownerId) {
        const ownerNode = contextData.nodes.find((n) => n.id === node.ownerId);
        if (ownerNode) prompt += `  (持有者: ${ownerNode.name})\n`;
      }
      if (node.factionId) {
        const factionNode = contextData.nodes.find(
          (n) => n.id === node.factionId
        );
        if (factionNode) prompt += `  (所属势力: ${factionNode.name})\n`;
      }
    });

    // 2. 软关联 (提及关系)
    if (contextData.edges.length > 0) {
      prompt += "\n【潜在联系】\n";
      contextData.edges.forEach((edge: RelationEdge) => {
        const relationLabel = this.getRelationLabel(edge.type);
        prompt += `- ${edge.source} ${relationLabel} ${edge.target} (${edge.context})\n`;
      });
    }

    prompt += "--- 上下文结束 ---\n";
    return prompt;
  }

  /**
   * 🔥 获取实体最新状态补丁 (Entity Status Patching)
   * 从时间线中获取实体的动态状态，避免静态 Bio 问题
   */
  private async getEntityStatusPatch(
    entityId: string,
    novelTitle: string
  ): Promise<{ status: string; eventTitle: string } | null> {
    try {
      // 获取该实体的最新时间线事件
      const events = await databaseService.getTimelineEvents(novelTitle);
      const relatedEvents = events
        .filter((event) => event.relatedEntityIds?.includes(entityId))
        .sort((a, b) => b.sortValue - a.sortValue); // 按时间倒序，最新的在前

      const latestEvent = relatedEvents[0];
      if (!latestEvent) return null;

      return {
        status: latestEvent.description || "",
        eventTitle: latestEvent.title || "未知事件",
      };
    } catch (error) {
      logger.warn("ContextEngine", "Failed to get entity status patch", {
        entityId,
        error,
      });
      return null;
    }
  }

  /**
   *  智能上下文组装 (Smart Context Assembly)
   * 基于优先级预算模型，而非盲目截断
   */
  private assemblePrioritizedContext(
    nodes: EntityNode[],
    edges: RelationEdge[],
    explicitNames: Set<string>, // 用户明确提及的名字集合 (@角色)
    maxChars: number, // 字符数预算
    novelTitle: string // 小说标题，用于获取状态补丁
  ): { content: string; usedEntityIds: string[] } {
    let currentChars = 0;
    const validBlocks: string[] = [];
    const usedEntityIds: string[] = [];

    // 1. 将所有实体转化为带权重的块
    const candidates: ContextBlock[] = nodes.map((node) => {
      let text = `- [${this.getEntityTypeLabel(node.type)}] ${node.name}: ${
        node.description
      }\n`;

      // 注入硬关联
      if (node.leaderId) {
        const leader = nodes.find((n) => n.id === node.leaderId);
        if (leader) text += `  (领导者: ${leader.name})\n`;
      }
      if (node.ownerId) {
        const owner = nodes.find((n) => n.id === node.ownerId);
        if (owner) text += `  (持有者: ${owner.name})\n`;
      }
      if (node.factionId) {
        const faction = nodes.find((n) => n.id === node.factionId);
        if (faction) text += `  (所属势力: ${faction.name})\n`;
      }

      // 🔥 计算权重
      // 显式提及的权重最高 (100)
      // 其他 RAG 检索出来的默认权重 (50)
      // 可以根据 id 在列表中的顺序微调权重 (index 越小分越高)
      const isExplicit = explicitNames.has(node.name);
      const basePriority = isExplicit ? 100 : 50;

      return {
        priority: basePriority,
        content: text,
        tokens: text.length,
        type: node.type,
        entityId: node.id,
      };
    });

    // 2. 排序：优先级高 -> 优先级低
    candidates.sort((a, b) => b.priority - a.priority);

    // 3. 贪心填装 (Greedy Packing)
    let prompt = "--- 🌍 世界观上下文 (按需加载) ---\n【相关实体】\n";

    // 先扣除 header 的长度
    currentChars += prompt.length;

    for (const block of candidates) {
      if (currentChars + block.tokens < maxChars) {
        validBlocks.push(block.content);
        currentChars += block.tokens;
        if (block.entityId) {
          usedEntityIds.push(block.entityId);
        }
      } else {
        // 预算耗尽，停止填装
        logger.debug("ContextEngine", `Dropped entity due to budget limit`, {
          entityType: block.type,
          entityId: block.entityId,
          priority: block.priority,
          requiredTokens: block.tokens,
          remainingBudget: maxChars - currentChars,
        });
      }
    }

    // 如果一个实体都没装进去，返回空
    if (validBlocks.length === 0) {
      return { content: "", usedEntityIds: [] };
    }

    prompt += validBlocks.join("");

    // 4. 尝试添加关系信息 (如果还有预算)
    if (edges.length > 0) {
      let edgeText = "\n【潜在联系】\n";
      let hasEdges = false;
      for (const edge of edges) {
        // 只有当边的两个端点都在 validBlocks 里（简单判断名字是否在最终文本里）时才添加
        // 这里为了性能做个简化：只要还有预算就往里填
        const line = `- ${edge.source} ${this.getRelationLabel(edge.type)} ${
          edge.target
        } (${edge.context})\n`;
        if (currentChars + line.length < maxChars) {
          edgeText += line;
          currentChars += line.length;
          hasEdges = true;
        }
      }
      if (hasEdges) prompt += edgeText;
    }

    prompt += "--- 上下文结束 ---\n";

    return { content: prompt, usedEntityIds };
  }

  /**
   * 获取实体类型标签
   * 遵循单一职责原则，专注于类型标签转换
   */
  private getEntityTypeLabel(type: string): string {
    const typeLabels = {
      character: "角色",
      setting: "场景",
      faction: "势力",
      item: "物品",
    };
    return typeLabels[type as keyof typeof typeLabels] || type;
  }

  /**
   * 获取关系标签
   * 遵循单一职责原则，专注于关系标签转换
   */
  private getRelationLabel(type: string): string {
    const relationLabels = {
      mention: "被提及于",
      ownership: "归属于",
      leadership: "领导着",
      membership: "隶属于",
      friend: "朋友",
      enemy: "敌人",
      family: "家人",
      lover: "恋人",
      custom: "自定义关系",
    };
    return relationLabels[type as keyof typeof relationLabels] || type;
  }

  /**
   * 根据实体ID批量查找实体
   * 用于 Graph-Walk 关联检索
   * @param entityIds 实体ID数组
   * @param novel 小说对象
   * @returns 实体对象数组
   */
  private async getEntitiesByIds(
    entityIds: string[],
    novel: Novel
  ): Promise<Array<Character | Setting | Faction | Item | null>> {
    const results: Array<Character | Setting | Faction | Item | null> = [];

    for (const entityId of entityIds) {
      const entity = this.findEntityById(entityId, novel);
      results.push(entity);
    }

    return results;
  }

  /**
   * 根据实体ID查找实体
   * 遵循单一职责原则，专注于实体查找逻辑
   * @param entityId 实体ID
   * @param novel 小说对象
   * @returns 实体对象或null
   */
  private findEntityById(
    entityId: string,
    novel: Novel
  ): Character | Setting | Faction | Item | null {
    // 在角色中查找
    const character = novel.characters?.find((c) => c.id === entityId);
    if (character) return character;

    // 在场景中查找
    const setting = novel.settings?.find((s) => s.id === entityId);
    if (setting) return setting;

    // 在势力中查找
    const faction = novel.factions?.find((f) => f.id === entityId);
    if (faction) return faction;

    // 在物品中查找
    const item = novel.items?.find((i) => i.id === entityId);
    if (item) return item;

    return null;
  }

  /**
   * 获取反向关系类型
   * 遵循单一职责原则，专注于关系类型反转逻辑
   * @param type 原始关系类型
   * @returns 反向关系类型
   */
  private getReverseRelationType(type: string): string {
    const reverseMap: Record<string, string> = {
      friend: "friend",
      enemy: "enemy",
      family: "family",
      lover: "lover",
      custom: "custom",
    };
    return reverseMap[type] || type;
  }

  /**
   * 构建完整的AI提示词
   * 遵循单一职责原则，专注于提示词组装逻辑
   *
   * ✅ 修复逻辑：
   * 1. 明确区分 System Prompt 和 Context
   * 2. 强制要求 AI 优先响应用户指令，而不是续写 Context
   * 3. 强制要求 AI 使用用户提问的语言回答
   */
  buildPrompt(context: string, userRequest: string): string {
    // 如果没有上下文，直接返回用户请求
    if (!context) {
      return userRequest;
    }

    // 使用结构化的 Prompt 格式，防止 AI 混淆"续写"和"回答"
    return `
<system_instruction>
你是一个专业的 AI 写作助手。你的任务是辅助作者创作，回答他们关于剧情、设定或大纲的问题。
请注意：
1. 下面提供的 <context> 仅作为参考资料（RAG），用于帮助你理解当前的故事背景。
2. 除非用户明确要求你"续写"、"扩写"或"生成正文"，否则**不要**直接续写小说内容。
3. 请直接回答用户的 <user_request>。
4. **重要**：请始终使用用户提问时所用的语言进行回答（例如：用户用中文提问，你就用中文回答），忽略上下文资料的语言。
</system_instruction>

<context>
${context}
</context>

<user_request>
${userRequest}
</user_request>
`.trim();
  }

  /**
   * 估算 Token 数量 (保守策略)
   * 为了安全起见，直接使用字符长度估算。
   * 现代模型（如 DeepSeek/GPT-4o）中文 Token 效率很高，通常 1 char < 1 token，
   * 所以用 char.length 作为估算值是安全的（会有留有余量）。
   */
  private estimateTokens(text: string): number {
    return text.length;
  }

  /**
   * 智能截断上下文 (Auto-Scaling Context)
   * 逻辑简化：以用户设置为准，默认兜底为 128k (2025年模型基准)
   * 用户设置 > 默认基准 > 物理极限 (如果未来能获取到)
   */
  private truncateContext(contextString: string): string {
    const state = useSettingsStore.getState();

    // 1. 定义现代模型的基准物理极限 (128k)
    // 如果是第三方中转，我们无法得知具体模型的极限，假设为 128k 是最合理的折中
    const STANDARD_MODEL_LIMIT = 128000;

    // 2. 获取用户设置的限制
    // 0 或 undefined 代表 "自动/不限制"
    const userSetting = state.contextTokenLimit;

    // 3. 计算最终生效限制 (Effective Limit)
    let finalLimit = STANDARD_MODEL_LIMIT;

    if (userSetting && userSetting > 0) {
      // 如果用户手动设置了值 (比如 16k, 32k)，则严格遵守用户的省钱/速度策略
      // 注意：即使用户设了 200k，我们这里也暂且认为是用户确认模型支持，
      // 考虑到通常模型就是 128k，如果用户设得比 128k 还大 (比如 Gemini 1M)，
      // 我们应该允许。
      finalLimit = userSetting;
    }

    // 4. 安全缓冲区 (Safety Buffer)
    // 无论限制多少，都要预留一部分给 "Output" 和 "System Prompt"
    // 假设预留 4000 token 给输出
    const safetyBuffer = 4000;
    const safeCeiling = Math.max(4000, finalLimit - safetyBuffer);

    // 5. 执行截断逻辑
    const currentTokens = this.estimateTokens(contextString);

    if (currentTokens <= safeCeiling) {
      return contextString;
    }

    // ✅ 修改：使用 logger 替代 console.warn
    logger.warn(
      "ContextEngine",
      `Truncating context: Input ${currentTokens} > Limit ${safeCeiling}`,
      { userSetting: userSetting || "Auto" }
    );

    // 按比例截断，保留头部核心设定（因为头部通常是世界观定义）
    const ratio = safeCeiling / currentTokens;
    const keepLength = Math.floor(contextString.length * ratio);

    return (
      contextString.slice(0, keepLength) +
      `\n\n[...系统提示：上下文已根据配置(${safeCeiling} tokens)进行优化截断...]`
    );
  }

  /**
   * 增强版上下文增强方法 - 包含 Token 保护
   */
  async enhancePromptWithRelations(userInput: string): Promise<string> {
    try {
      const entities = await this.intelligentEntityParsing(userInput);
      const contextData = await this.retrieveEnhancedContext(entities);
      let context = this.assembleEnhancedContext(contextData);

      // ✅ 新增：应用截断逻辑
      context = this.truncateContext(context);

      const enhancedPrompt = this.buildPrompt(context, userInput);
      return enhancedPrompt;
    } catch (error) {
      console.error("关系感知上下文增强失败:", error);
      return userInput;
    }
  }

  /**
   * 检查内容一致性
   * 遵循单一职责原则，专注于一致性检查逻辑
   */
  async checkConsistency(
    content: string,
    entities: ParsedEntities
  ): Promise<{
    isConsistent: boolean;
    issues: string[];
  }> {
    const contextData = await this.retrieveContext(entities);
    const issues: string[] = [];

    // 检查角色一致性
    if (contextData.characterData) {
      const character = contextData.characterData;
      // 简单的一致性检查：确保内容中包含角色名称
      if (!content.includes(character.name)) {
        issues.push(`内容中未提及角色 "${character.name}"`);
      }
    }

    // 检查场景一致性
    if (contextData.settingData) {
      const setting = contextData.settingData;
      if (!content.includes(setting.name)) {
        issues.push(`内容中未提及场景 "${setting.name}"`);
      }
    }

    // 检查势力一致性
    if (contextData.factionData) {
      const faction = contextData.factionData;
      if (!content.includes(faction.name)) {
        issues.push(`内容中未提及势力 "${faction.name}"`);
      }
    }

    // 检查物品一致性
    if (contextData.itemData) {
      const item = contextData.itemData;
      if (!content.includes(item.name)) {
        issues.push(`内容中未提及物品 "${item.name}"`);
      }
    }

    return {
      isConsistent: issues.length === 0,
      issues,
    };
  }

  /**
   * 提示词模板渲染引擎
   * 将模板字符串中的 {{variable}} 替换为实际内容
   * 遵循单一职责原则，专注于变量替换逻辑
   *
   * @param templateContent 模板内容，支持 {{variable}} 语法
   * @param variables 变量对象，包含要注入的变量值
   * @returns 渲染后的完整提示词
   */
  async hydratePrompt(
    templateContent: string,
    variables: PromptVariables
  ): Promise<string> {
    let hydrated = templateContent;

    try {
      // 1. 替换 {{selection}} - ✅ 优化正则，允许空格
      if (variables.selection !== undefined) {
        hydrated = hydrated.replace(
          /\{\{\s*selection\s*\}\}/g,
          variables.selection
        );
      }

      // 2. 替换 {{input}}
      if (variables.input !== undefined) {
        hydrated = hydrated.replace(/\{\{\s*input\s*\}\}/g, variables.input);
      }

      // 3. 处理 {{context}} - 这是最关键的一步
      // 使用 search 检查是否存在 (正则)
      if (/\{\{\s*context\s*\}\}/.test(hydrated)) {
        let contextString = "";

        // 如果已经提供了 context 变量，直接使用
        if (variables.context) {
          contextString = variables.context;
        } else {
          // 否则，智能分析上下文并生成
          const textToAnalyze =
            (variables.selection || "") + " " + (variables.input || "");
          if (textToAnalyze.trim()) {
            // 使用现有的关系感知上下文增强方法
            contextString = await this.enhancePromptWithRelations(
              textToAnalyze
            );
          }
        }

        // 替换时也使用宽松正则
        hydrated = hydrated.replace(/\{\{\s*context\s*\}\}/g, contextString);
      }

      // 4. 处理其他自定义变量
      Object.keys(variables).forEach((key) => {
        if (
          key !== "selection" &&
          key !== "input" &&
          key !== "context" &&
          variables[key] !== undefined
        ) {
          // ✅ 优化：允许变量名周围有空格
          const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
          // 使用替换函数避免特殊字符解析问题
          hydrated = hydrated.replace(regex, () => variables[key]!);
        }
      });

      return hydrated;
    } catch (error) {
      console.error("提示词模板渲染失败:", error);
      // 如果出错，返回原始模板内容
      return templateContent;
    }
  }

  /**
   * ✅ 新增：分析上下文并返回元数据
   * 用于 UI 展示 AI 到底引用了哪些实体
   * 遵循单一职责原则，专注于上下文分析和元数据提取
   */
  async analyzeContext(userInput: string): Promise<{
    prompt: string;
    usedEntities: { type: string; name: string; id: string }[];
    stats: ContextStats;
  }> {
    // 默认调用升级版方法，只包含世界观
    return this.analyzeContextWithOptions(userInput, {
      includeWorld: true,
      includeChapter: false,
      includeOutline: false,
    });
  }

  /**
   * 🚀 三级记忆架构上下文分析 (重构版 - 基于优先级预算系统)
   * 实现智能的上下文预算分配，而非盲目截断
   */
  async analyzeContextWithOptions(
    userInput: string,
    options: ContextAnalysisOptions = {
      includeWorld: true,
      includeChapter: true,
      includeOutline: true,
    }
  ): Promise<{
    prompt: string;
    usedEntities: { type: string; name: string; id: string }[];
    stats: ContextStats;
  }> {
    try {
      // 1. 获取配置和预算
      const { currentNovelTitle, activeChapterId } = useUiStore.getState();
      const settings = useSettingsStore.getState();

      if (!currentNovelTitle) throw new Error("No novel selected");

      const novel = await databaseService.loadNovel(currentNovelTitle);
      if (!novel) throw new Error("Novel not found");

      // 💡 获取总 Token 预算 (默认 128k)
      const TOTAL_BUDGET = settings.contextTokenLimit || 128000;
      // 预留给 Output 和 System Prompt 的安全空间
      const RESERVED_BUDGET = 4000;
      // 这是一个动态变化的"剩余预算"
      let remainingBudget = TOTAL_BUDGET - RESERVED_BUDGET;

      const contextBlocks: string[] = [];
      let usedEntities: any[] = [];

      // ✅ 初始化统计
      const stats: ContextStats = {
        totalCharacters: 0,
        previousChaptersCount: 0,
        includesSummary: false,
        includesStyle: false,
        includesRAG: false,
      };

      // ==========================================
      // P0: 必须包含的核心协议 (Style & Current Draft)
      // ==========================================

      // 1. 文风协议
      if (novel.metadata) {
        const styleInstruction =
          styleInjectionService.buildStyleSystemInstruction(novel.metadata);
        if (styleInstruction) {
          contextBlocks.push(styleInstruction);
          stats.includesStyle = true;
          remainingBudget -= styleInstruction.length; // 扣除预算
        }
      }

      // 2. 本章目标 & 草稿 (这是最重要的上下文)
      const activeChapter = novel.chapters?.find(
        (c) => c.id === activeChapterId
      );
      let currentChapterText = "";
      if (activeChapter) {
        if (activeChapter.description) {
          currentChapterText += `\n=== 🎯 本章目标 ===\n${activeChapter.description}\n`;
        }
        if (activeChapter.content) {
          const plainText = cleanNovelContent(activeChapter.content);
          // 草稿最多取后 3000 字，保证相关性
          currentChapterText += `\n=== 📝 本章已写 ===\n...${plainText.slice(
            -3000
          )}\n`;
        }
        if (currentChapterText) {
          contextBlocks.push(currentChapterText);
          remainingBudget -= currentChapterText.length;
        }
      }

      // ==========================================
      // P1: 显式提及的实体 (Explicit Entities)
      // P2: 向量检索的实体 (Implicit Entities)
      // ==========================================

      if (options.includeWorld) {
        // 1. 获取显式提及 (Keywords)
        const explicitParsed = this.parseEntities(userInput);
        const explicitNames = new Set([
          ...explicitParsed.characters,
          ...explicitParsed.settings,
          ...explicitParsed.factions,
          ...explicitParsed.items,
        ]);

        // 2. 获取所有相关实体 (包含显式 + 向量搜索)
        // intelligentEntityParsing 内部已经做了 Hybrid Search (Keyword + Index)
        const entities = await this.intelligentEntityParsing(userInput);

        // 3. 🔥 Graph-Walk 关联检索 (图游走扩展)
        // 如果预算还很充足 (比如还剩 50k token)，我们可以奢侈一点
        const expandedEntityIds = new Set<string>();

        // 获取基础实体ID
        const entityMap = await this.getEntityMap();
        const baseEntityIds = new Set<string>();

        // 将解析出的实体名称转换为ID
        [
          ...entities.characters,
          ...entities.settings,
          ...entities.factions,
          ...entities.items,
        ].forEach((name) => {
          const meta = entityMap.get(name.toLowerCase());
          if (meta) baseEntityIds.add(meta.id);
        });

        // 如果预算充足，执行图游走扩展
        if (remainingBudget > 20000) {
          for (const entityId of baseEntityIds) {
            // 获取该实体的强关系
            const relationships =
              await databaseService.getRelationshipsByEntity(entityId);

            // 筛选出极其重要的关系 (如：当前场景下的伴侣、正在追杀他的仇人)
            const vitalRelations = relationships.filter((r) =>
              ["lover", "enemy", "master", "companion", "family"].includes(
                r.type
              )
            );

            vitalRelations.forEach((r) => {
              const target = r.sourceId === entityId ? r.targetId : r.sourceId;
              expandedEntityIds.add(target); // 自动把相关人员拉入上下文
            });
          }

          logger.debug("ContextEngine", "Graph-Walk expansion completed", {
            baseEntities: baseEntityIds.size,
            expandedEntities: expandedEntityIds.size,
            remainingBudget,
          });
        }

        // 合并基础实体和扩展实体
        const allEntityIds = new Set([...baseEntityIds, ...expandedEntityIds]);

        // 4. 获取详细数据
        const contextData = await this.retrieveEnhancedContext(entities);

        // 5. 如果有扩展实体，额外获取它们的数据
        if (expandedEntityIds.size > 0) {
          const expandedEntities = await this.getEntitiesByIds(
            Array.from(expandedEntityIds),
            novel
          );
          // 将扩展实体添加到上下文中，但权重较低
          expandedEntities.forEach((entity) => {
            if (entity) {
              // 根据实体类型添加到相应的数组中
              const entityName = (entity as any).name;
              const entityType =
                (entity as any).id ===
                novel.characters?.find((c) => c.id === (entity as any).id)?.id
                  ? "character"
                  : (entity as any).id ===
                    novel.settings?.find((s) => s.id === (entity as any).id)?.id
                  ? "setting"
                  : (entity as any).id ===
                    novel.factions?.find((f) => f.id === (entity as any).id)?.id
                  ? "faction"
                  : "item";

              switch (entityType) {
                case "character":
                  if (!entities.characters.includes(entityName)) {
                    entities.characters.push(entityName);
                  }
                  break;
                case "setting":
                  if (!entities.settings.includes(entityName)) {
                    entities.settings.push(entityName);
                  }
                  break;
                case "faction":
                  if (!entities.factions.includes(entityName)) {
                    entities.factions.push(entityName);
                  }
                  break;
                case "item":
                  if (!entities.items.includes(entityName)) {
                    entities.items.push(entityName);
                  }
                  break;
              }
            }
          });

          // 重新获取包含扩展实体的完整上下文数据
          const enhancedContextData = await this.retrieveEnhancedContext(
            entities
          );
          // 合并节点和边
          contextData.nodes.push(
            ...enhancedContextData.nodes.filter(
              (node) =>
                !contextData.nodes.some((existing) => existing.id === node.id)
            )
          );
          contextData.edges.push(
            ...enhancedContextData.edges.filter(
              (edge) =>
                !contextData.edges.some(
                  (existing) =>
                    existing.source === edge.source &&
                    existing.target === edge.target
                )
            )
          );
        }

        // 4. 🔥 分配 RAG 预算
        // 假设我们愿意给 RAG 分配剩余预算的 60% (或者固定值，看策略)
        // 这里策略：只要有预算，优先给实体
        const ragBudget = Math.floor(remainingBudget * 0.7);

        const { content: worldContext, usedEntityIds } =
          this.assemblePrioritizedContext(
            contextData.nodes,
            contextData.edges,
            explicitNames,
            ragBudget,
            currentNovelTitle
          );

        if (worldContext) {
          contextBlocks.push(worldContext);
          remainingBudget -= worldContext.length;

          // 记录使用的实体 (用于 UI 高亮)
          usedEntities = contextData.nodes
            .filter((node) => usedEntityIds.includes(node.id))
            .map((n) => ({ type: n.type, name: n.name, id: n.id }));
          stats.includesRAG = usedEntities.length > 0;
        }
      }

      // ==========================================
      // P3: 中期记忆 (Recent Chapters)
      // ==========================================

      if (options.includeChapter && activeChapterId && novel.chapters) {
        // 用户设置的窗口大小 (比如 5000)
        const userWindowSetting = settings.contextWindowSize;
        // 实际窗口 = Min(用户设置, 剩余预算)
        const effectiveWindow = Math.min(userWindowSetting, remainingBudget);

        if (effectiveWindow > 500) {
          // 如果剩余空间太小，不如不加
          const sortedChapters = novel.chapters.sort(
            (a, b) => (a.order || 0) - (b.order || 0)
          );
          const activeIndex = sortedChapters.findIndex(
            (c) => c.id === activeChapterId
          );

          if (activeIndex > 0) {
            let accumulatedText = "";
            let currentLength = 0;
            let chaptersIncluded = 0;
            let firstIncludedOrder: number | null = null;
            let lastIncludedOrder: number | null = null;

            // 从上一章开始，倒序遍历，直到填满窗口
            for (let i = activeIndex - 1; i >= 0; i--) {
              const ch = sortedChapters[i];
              const content = cleanNovelContent(ch.content || "");

              if (!content) continue;

              // 记录章节范围
              if (firstIncludedOrder === null) {
                firstIncludedOrder = ch.order;
              }
              lastIncludedOrder = ch.order;

              // 检查是否会爆窗口
              if (currentLength + content.length > effectiveWindow) {
                const remainingSpace = effectiveWindow - currentLength;
                if (remainingSpace > 500) {
                  const partialContent = content.slice(-remainingSpace);
                  accumulatedText =
                    `\n--- (第${ch.order}章 ${ch.title} 节选) ---\n${partialContent}\n` +
                    accumulatedText;
                }
                break;
              }

              accumulatedText =
                `\n--- (第${ch.order}章 ${ch.title}) ---\n${content}\n` +
                accumulatedText;
              currentLength += content.length;
              chaptersIncluded++;

              if (chaptersIncluded >= 10) break;
            }

            if (accumulatedText) {
              contextBlocks.push(`
=== ⏮️ 前情提要 (最近 ${chaptersIncluded} 章原文回顾) ===
(这是距离当前进度最近的原文，用于保持剧情连贯性和文风一致性)
${accumulatedText}
==================================================
`);
              remainingBudget -= accumulatedText.length;
              stats.previousChaptersCount = chaptersIncluded;

              // 计算章节范围
              if (firstIncludedOrder !== null && lastIncludedOrder !== null) {
                if (firstIncludedOrder === lastIncludedOrder) {
                  stats.previousChaptersRange = `第${firstIncludedOrder}章`;
                } else {
                  stats.previousChaptersRange = `第${lastIncludedOrder}-${firstIncludedOrder}章`;
                }
              }
            }
          }
        }
      }

      // ==========================================
      // P4: 长期记忆 (Outline Summary) - 优先级最低
      // ==========================================

      if (options.includeOutline && remainingBudget > 1000 && novel.chapters) {
        // 对章节排序
        const sortedChapters = novel.chapters.sort(
          (a, b) => (a.order || 0) - (b.order || 0)
        );
        const activeIndex = sortedChapters.findIndex(
          (c) => c.id === activeChapterId
        );

        let storySummaries = "=== 📚 剧情历史 (已发生的故事摘要) ===\n";

        // 按卷分组构建摘要
        const volumes = novel.volumes || [];
        volumes.forEach((vol) => {
          const volChapters = sortedChapters.filter(
            (c) => c.volumeId === vol.id
          );
          const pastChaptersInVol = volChapters.filter(
            (c) => sortedChapters.indexOf(c) < activeIndex
          );

          if (pastChaptersInVol.length > 0) {
            storySummaries += `\n【卷：${vol.title}】\n`;
            pastChaptersInVol.forEach((c) => {
              if (c.description) {
                storySummaries += `- 第${c.order}章 ${c.title}: ${c.description}\n`;
              }
            });
          }
        });
        storySummaries += "========================================\n";

        // 检查预算并添加
        if (
          storySummaries.includes("- 第") &&
          storySummaries.length < remainingBudget
        ) {
          contextBlocks.push(storySummaries);
          stats.includesSummary = true;
        }
      }

      // ==========================================
      // 🥪 三明治结构重排 (Sandwich Reordering)
      // 对抗 "Lost in the Middle" 现象
      // ==========================================

      // 将上下文块按重要性分层
      const systemBlocks: string[] = []; // 顶层：文风协议等
      const backgroundBlocks: string[] = []; // 中层：大纲摘要、前文回顾
      const priorityContextBlocks: string[] = []; // 底层：实体详情、最近草稿

      // 分类上下文块
      contextBlocks.forEach((block) => {
        if (block.includes("文风协议") || block.includes("世界观基调")) {
          systemBlocks.push(block);
        } else if (block.includes("剧情历史") || block.includes("前情提要")) {
          backgroundBlocks.push(block);
        } else {
          priorityContextBlocks.push(block);
        }
      });

      // 🥪 三明治组装：System -> Background -> Context -> User
      const orderedBlocks = [
        ...systemBlocks,
        ...backgroundBlocks,
        ...priorityContextBlocks,
      ];

      // 最终组装
      const prompt =
        orderedBlocks.join("\n\n") +
        `\n\n<user_request>\n${userInput}\n</user_request>`;
      stats.totalCharacters = prompt.length;

      logger.debug("ContextEngine", "Sandwich structure assembly completed", {
        systemBlocks: systemBlocks.length,
        backgroundBlocks: backgroundBlocks.length,
        contextBlocks: priorityContextBlocks.length,
        totalTokens: this.estimateTokens(prompt),
      });

      return { prompt, usedEntities, stats };
    } catch (error) {
      logger.error("ContextEngine", "Context analysis failed", { error });
      // 返回默认统计数据
      const defaultStats: ContextStats = {
        totalCharacters: userInput.length,
        previousChaptersCount: 0,
        includesSummary: false,
        includesStyle: false,
        includesRAG: false,
      };
      return { prompt: userInput, usedEntities: [], stats: defaultStats };
    }
  }

  /**
   * 修改：保持原有接口兼容，但内部调用新逻辑
   * 遵循开放封闭原则，通过内部重构实现功能增强而不破坏现有接口
   */
  async enhancePrompt(userInput: string): Promise<string> {
    const { prompt } = await this.analyzeContext(userInput);
    return prompt;
  }

  /**
   * 获取可用的提示词变量列表
   * 遵循单一职责原则，专注于变量元数据管理
   *
   * @returns 变量列表及其描述
   */
  getAvailableVariables(): Array<{
    name: string;
    value: string;
    description: string;
  }> {
    return [
      {
        name: "世界观",
        value: "{{context}}",
        description: "自动注入相关的角色、场景和势力信息",
      },
      {
        name: "选中文本",
        value: "{{selection}}",
        description: "当前编辑器选中的文本或上文内容",
      },
      {
        name: "用户输入",
        value: "{{input}}",
        description: "用户在AI面板中输入的额外指令",
      },
    ];
  }
  /**
   * 🚀 混合检索 (Hybrid Search) - 升级版
   * 结合 关键词匹配 (高精度) + 向量检索 (高召回/语义)
   */
  async semanticRetrieve(text: string, novelTitle: string): Promise<string[]> {
    logger.info("ContextEngine", "Starting hybrid semantic retrieval", {
      text,
      novelTitle,
    });

    const retrievedIds = new Set<string>();
    const novel = await databaseService.loadNovel(novelTitle);
    if (!novel) {
      logger.error("ContextEngine", "Novel not found for retrieval", {
        novelTitle,
      });
      return [];
    }

    // 1. 关键词匹配 (保留原有逻辑，因为它快且准)
    // 如果用户明确写了 "王铁"，我们就不需要猜
    const localEntities = await this.intelligentEntityParsing(text);

    // 将关键词匹配的结果转换为ID
    const entityMap = await this.getEntityMap();
    const allNames = [
      ...localEntities.characters,
      ...localEntities.settings,
      ...localEntities.factions,
      ...localEntities.items,
    ];

    allNames.forEach((name) => {
      const meta = entityMap.get(name.toLowerCase());
      if (meta) retrievedIds.add(meta.id);
    });

    logger.debug("ContextEngine", "Keyword matching results", {
      foundNames: allNames.length,
      foundIds: retrievedIds.size,
    });

    // 2. 向量检索 (解决"拿着锤子的光头"找不到"王铁"的问题)
    // 只有当文本长度足够，且看起来像在描述特征时才调用
    if (text.length > 5 && retrievedIds.size < 3) {
      try {
        logger.debug("ContextEngine", "Starting vector semantic search");

        // ✅ 从 Store 获取 RAG 配置
        const { ragOptions } = useSettingsStore.getState();

        const semanticResults = await embeddingService.semanticSearch(
          text,
          novelTitle,
          {
            threshold: ragOptions.threshold, // ✅ 使用配置值
            topK: ragOptions.limit, // ✅ 使用配置值
            includeTypes: ["character", "item", "setting", "faction"],
          }
        );

        semanticResults.forEach((result) => {
          retrievedIds.add(result.id);
        });

        if (semanticResults.length > 0) {
          logger.info("ContextEngine", "Vector search matches", {
            matches: semanticResults.map(
              (r) => `${r.name}(${r.type})=${r.score.toFixed(2)}`
            ),
          });
        }
      } catch (e) {
        logger.warn(
          "ContextEngine",
          "Semantic retrieval failed (API error or cost saving mode)",
          { error: e }
        );
      }
    }

    // 3. 时间线事件匹配 (保持原有逻辑)
    const events = await databaseService.getTimelineEvents(novelTitle);
    events.forEach((evt) => {
      if (text.includes(evt.title)) {
        retrievedIds.add(evt.id);
      }
    });

    const finalResults = Array.from(retrievedIds);
    logger.success("ContextEngine", "Hybrid retrieval completed", {
      totalResults: finalResults.length,
      keywordMatches: allNames.length,
      vectorMatches: retrievedIds.size - allNames.length,
    });

    return finalResults;
  }

  /**
   * 🚀 动态上下文组装 (Dynamic Context Assembly)
   * 解决 "上下文污染" 和 "状态滞后"
   */
  async assembleDynamicContext(
    entityIds: string[],
    novelTitle: string
  ): Promise<string> {
    logger.info("ContextEngine", "Starting dynamic context assembly", {
      entityIds,
      novelTitle,
    });

    const novel = await databaseService.loadNovel(novelTitle);
    if (!novel) {
      logger.error("ContextEngine", "Novel not found for context assembly", {
        novelTitle,
      });
      return "";
    }

    let contextPrompt = "--- 🌍 相关世界观 (动态) ---\n";

    // 获取所有时间线事件，用于查找最新状态
    const timelineEvents = await databaseService.getTimelineEvents(novelTitle);

    for (const id of entityIds) {
      // 1. 查找实体基础信息
      const char = novel.characters?.find((c) => c.id === id);
      const item = novel.items?.find((i) => i.id === id);
      const setting = novel.settings?.find((s) => s.id === id);
      const faction = novel.factions?.find((f) => f.id === id);

      if (char) {
        // 2. 查找该实体的"最新状态" (从时间线中提取)
        // 逻辑：找到关联了该角色的、排序值最大的(最新的)事件
        const relatedEvents = timelineEvents
          .filter((e) => e.relatedEntityIds?.includes(id))
          .sort((a, b) => b.sortValue - a.sortValue); // 倒序，最新的在前

        const latestEvent = relatedEvents[0];

        // 3. 组装精简信息 (避免 Bio 污染)
        contextPrompt += `【角色】${char.name}\n`;
        // 只放核心特征，不放几千字的背景故事
        contextPrompt += `特征: ${getPlainTextSnippet(
          char.appearance || "",
          50
        )} ${getPlainTextSnippet(char.personality || "", 30)}\n`;

        // 4. 注入动态状态
        if (latestEvent) {
          contextPrompt += `🚨 当前状态(参考事件"${
            latestEvent.title
          }"): 此时他${(latestEvent.description || "").slice(0, 100)}...\n`;
        }

        contextPrompt += "\n";
      }

      if (item) {
        // 物品逻辑：查持有者
        const ownerName =
          novel.characters?.find((c) => c.id === item.ownerId)?.name ||
          "无/未知";
        contextPrompt += `【物品】${item.name} (当前持有者: ${ownerName})\n`;
        contextPrompt += `功能: ${getPlainTextSnippet(
          item.abilities || "",
          50
        )}\n\n`;
      }

      if (setting) {
        contextPrompt += `【场景】${setting.name}\n`;
        contextPrompt += `描述: ${getPlainTextSnippet(
          setting.description || "",
          80
        )}\n`;
        if (setting.atmosphere) {
          contextPrompt += `氛围: ${getPlainTextSnippet(
            setting.atmosphere,
            50
          )}\n`;
        }
        contextPrompt += "\n";
      }

      if (faction) {
        contextPrompt += `【势力】${faction.name}\n`;
        contextPrompt += `理念: ${getPlainTextSnippet(
          faction.ideology || "",
          50
        )}\n`;
        if (faction.leaderId) {
          const leaderName =
            novel.characters?.find((c) => c.id === faction.leaderId)?.name ||
            "未知";
          contextPrompt += `领导者: ${leaderName}\n`;
        }
        contextPrompt += "\n";
      }
    }

    logger.success("ContextEngine", "Dynamic context assembly completed", {
      entityCount: entityIds.length,
      contextLength: contextPrompt.length,
    });

    return contextPrompt;
  }

  /**
   * 手动组装上下文 (Manual Context Assembly) - 保持向后兼容
   * 将 Store 中的 activeData 转换为 Prompt 字符串
   */
  assembleManualContext(activeData: any): string {
    const blocks: string[] = [];

    // 1. 时间线/事件 (高优先级)
    if (activeData.events && activeData.events.length > 0) {
      const eventsStr = activeData.events
        .map(
          (e: any) =>
            `- 【当前事件】${e.title} (${e.dateDisplay}): ${e.description}`
        )
        .join("\n");
      blocks.push(eventsStr);
    }

    // 2. 角色
    if (activeData.characters && activeData.characters.length > 0) {
      const charStr = activeData.characters
        .map(
          (c: any) =>
            `- [角色] ${c.name}: ${getPlainTextSnippet(
              c.description || "",
              100
            )}`
        )
        .join("\n");
      blocks.push(charStr);
    }

    // 3. 势力 & 场景 & 物品
    // ... 类似逻辑组装 ...
    if (activeData.settings && activeData.settings.length > 0) {
      blocks.push(
        activeData.settings
          .map((s: any) => `- [场景] ${s.name}: ${s.description}`)
          .join("\n")
      );
    }

    if (activeData.factions && activeData.factions.length > 0) {
      blocks.push(
        activeData.factions
          .map((f: any) => `- [势力] ${f.name}: ${f.description}`)
          .join("\n")
      );
    }

    if (activeData.items && activeData.items.length > 0) {
      blocks.push(
        activeData.items
          .map((i: any) => `- [物品] ${i.name}: ${i.description}`)
          .join("\n")
      );
    }

    if (blocks.length === 0) return "";

    return `--- 🌍 当前激活的剧情环境 (Context Radar) ---\n${blocks.join(
      "\n\n"
    )}\n--- 上下文结束 ---\n`;
  }

  /**
   * 🚀 增强版上下文检索 - 使用混合检索和动态状态注入
   * 这是新的主要入口点，替代原有的 retrieveEnhancedContext
   */
  async retrieveContextWithDynamicState(
    text: string,
    novelTitle: string
  ): Promise<string> {
    try {
      // 1. 使用混合检索获取相关实体ID
      const entityIds = await this.semanticRetrieve(text, novelTitle);

      if (entityIds.length === 0) {
        logger.info("ContextEngine", "No entities found for context retrieval");
        return "";
      }

      // 2. 使用动态上下文组装
      const dynamicContext = await this.assembleDynamicContext(
        entityIds,
        novelTitle
      );

      return dynamicContext;
    } catch (error) {
      logger.error("ContextEngine", "Dynamic context retrieval failed", {
        error,
      });
      return "";
    }
  }

  /**
   * 获取过去章节的回顾 (Recap)
   * 🌟 双字段策略核心：优先使用 Summary (事实)，降级使用 Description (计划)
   */
  private getChapterRecap(
    activeChapterId: string,
    novel: Novel,
    limit: number = 5
  ): string {
    if (!novel?.chapters) return "";

    // 1. 排序章节 (确保顺序正确)
    const sortedChapters = [...novel.chapters].sort(
      (a, b) => (a.order || 0) - (b.order || 0)
    );

    // 2. 找到当前章节索引
    const currentIndex = sortedChapters.findIndex(
      (c) => c.id === activeChapterId
    );
    if (currentIndex <= 0) return "";

    // 3. 向前取 limit 个章节
    const startIndex = Math.max(0, currentIndex - limit);
    const pastChapters = sortedChapters.slice(startIndex, currentIndex);

    // 4. 组装回顾
    const recapText = pastChapters
      .map((c) => {
        // 🌟 核心逻辑：Fact > Plan
        // 如果有 summary (写完后生成的)，用 summary
        // 如果没有 summary，用 description (写前的细纲)
        // 如果都没有，用 "暂无记录"
        const content = c.summary?.trim()
          ? c.summary
          : c.description?.trim() || "";

        if (!content) return null;

        return `【第${c.order + 1}章 ${c.title}】: ${content}`;
      })
      .filter(Boolean)
      .join("\n");

    return recapText ? `\n=== 📜 前情提要 (剧情回溯) ===\n${recapText}\n` : "";
  }
}

// 导出单例实例
export const contextEngineService = new ContextEngineService();
