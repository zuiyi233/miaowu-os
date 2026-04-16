// services/embeddingService.ts
// 增强版Embedding服务，支持批量生成、缓存和混合检索

import { cosineSimilarity } from "../lib/utils/math";
import { createEmbedding } from "./llmService";
import { databaseService, db } from "../lib/storage/db";
import { toast } from "sonner";
import { logger } from "../lib/logging";
import type { Character, Item, Setting, Faction } from "../types";

// 定义日志上下文
const EMBEDDING_CONTEXT = "EmbeddingService";

/**
 * 检查是否需要更新向量 (内容变动后才更新)
 * @param entity 实体对象
 * @returns 是否需要更新向量
 */
const shouldUpdateEmbedding = (entity: any): boolean => {
  // 简单逻辑：如果没有向量，或者最后更新时间晚于上次向量生成时间
  return !entity.embedding || entity.embedding.length === 0;
};

/**
 * 构建实体的语义丰富文本用于Embedding
 * @param type 实体类型
 * @param item 实体对象
 * @returns 用于生成向量的文本
 */
const buildEmbeddingText = (type: string, item: any): string => {
  const parts: string[] = [];

  // 添加类型标识
  parts.push(`[${type}]`);

  // 添加名称
  if (item.name) {
    parts.push(item.name);
  }

  // 添加描述
  if (item.description) {
    parts.push(item.description);
  }

  // 根据类型添加特定字段
  switch (type) {
    case "character":
      if (item.appearance) parts.push(item.appearance);
      if (item.personality) parts.push(item.personality);
      if (item.abilities) parts.push(item.abilities);
      if (item.backstory) parts.push(item.backstory);
      break;
    case "item":
      if (item.appearance) parts.push(item.appearance);
      if (item.abilities) parts.push(item.abilities);
      if (item.history) parts.push(item.history);
      break;
    case "setting":
      if (item.atmosphere) parts.push(item.atmosphere);
      if (item.history) parts.push(item.history);
      if (item.keyFeatures) parts.push(item.keyFeatures);
      break;
    case "faction":
      if (item.ideology) parts.push(item.ideology);
      if (item.goals) parts.push(item.goals);
      if (item.structure) parts.push(item.structure);
      if (item.resources) parts.push(item.resources);
      break;
  }

  return parts.join("。");
};

/**
 * 🚀 增强版Embedding服务
 * 支持批量生成、缓存和智能更新
 */
export const embeddingService = {
  /**
   * 为所有实体生成/更新向量索引
   * 建议在空闲时或用户点击"构建索引"时运行
   */
  async syncAllEmbeddings(novelId: string): Promise<void> {
    logger.info(EMBEDDING_CONTEXT, "Starting embedding sync", { novelId });

    const novel = await databaseService.loadNovel(novelId);
    if (!novel) {
      logger.error(EMBEDDING_CONTEXT, "Novel not found", { novelId });
      return;
    }

    const entitiesToUpdate: { type: string; item: any }[] = [];

    // 收集需要更新的实体
    novel.characters?.forEach((c) => {
      if (shouldUpdateEmbedding(c))
        entitiesToUpdate.push({ type: "character", item: c });
    });

    novel.items?.forEach((i) => {
      if (shouldUpdateEmbedding(i))
        entitiesToUpdate.push({ type: "item", item: i });
    });

    novel.settings?.forEach((s) => {
      if (shouldUpdateEmbedding(s))
        entitiesToUpdate.push({ type: "setting", item: s });
    });

    novel.factions?.forEach((f) => {
      if (shouldUpdateEmbedding(f))
        entitiesToUpdate.push({ type: "faction", item: f });
    });

    if (entitiesToUpdate.length === 0) {
      logger.info(EMBEDDING_CONTEXT, "No entities need embedding update");
      toast.info("所有实体的向量索引已是最新");
      return;
    }

    const toastId = toast.loading(
      `正在构建 ${entitiesToUpdate.length} 个实体的语义索引...`
    );

    try {
      // 串行处理，避免API Rate Limit
      let successCount = 0;
      let errorCount = 0;

      for (const { type, item } of entitiesToUpdate) {
        try {
          // 构建语义丰富的文本用于 Embedding
          const textToEmbed = buildEmbeddingText(type, item);

          const embedding = await createEmbedding(textToEmbed);

          if (embedding && embedding.length > 0) {
            // 保存回数据库
            const updateData = {
              embedding,
              lastEmbedded: Date.now(),
            };

            switch (type) {
              case "character":
                await db.characters.update(item.id, updateData);
                break;
              case "item":
                await db.items.update(item.id, updateData);
                break;
              case "setting":
                await db.settings.update(item.id, updateData);
                break;
              case "faction":
                await db.factions.update(item.id, updateData);
                break;
            }

            successCount++;
            logger.debug(EMBEDDING_CONTEXT, "Embedding updated", {
              type,
              name: item.name,
            });
          }
        } catch (e) {
          errorCount++;
          logger.error(EMBEDDING_CONTEXT, "Failed to embed entity", {
            type,
            name: item.name,
            error: e,
          });
        }
      }

      toast.success(
        `语义索引构建完成！成功: ${successCount}, 失败: ${errorCount}`,
        { id: toastId }
      );
      logger.success(EMBEDDING_CONTEXT, "Embedding sync completed", {
        total: entitiesToUpdate.length,
        success: successCount,
        error: errorCount,
      });
    } catch (error) {
      toast.error("语义索引构建失败", { id: toastId });
      logger.error(EMBEDDING_CONTEXT, "Embedding sync failed", { error });
    }
  },

  /**
   * 为单个实体生成/更新向量
   * @param type 实体类型
   * @param entity 实体对象
   */
  async updateEntityEmbedding(type: string, entity: any): Promise<void> {
    try {
      const textToEmbed = buildEmbeddingText(type, entity);
      const embedding = await createEmbedding(textToEmbed);

      if (embedding && embedding.length > 0) {
        const updateData = {
          embedding,
          lastEmbedded: Date.now(),
        };

        switch (type) {
          case "character":
            await db.characters.update(entity.id, updateData);
            break;
          case "item":
            await db.items.update(entity.id, updateData);
            break;
          case "setting":
            await db.settings.update(entity.id, updateData);
            break;
          case "faction":
            await db.factions.update(entity.id, updateData);
            break;
        }

        logger.success(EMBEDDING_CONTEXT, "Entity embedding updated", {
          type,
          name: entity.name,
        });
      }
    } catch (error) {
      logger.error(EMBEDDING_CONTEXT, "Failed to update entity embedding", {
        type,
        name: entity.name,
        error,
      });
      throw error;
    }
  },

  /**
   * 🚀 混合检索 (Hybrid Search)
   * 结合 关键词匹配 (高精度) + 向量检索 (高召回/语义)
   */
  async semanticSearch(
    queryText: string,
    novelId: string,
    options: {
      threshold?: number;
      topK?: number;
      includeTypes?: string[];
    } = {}
  ): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      score: number;
      entity: any;
    }>
  > {
    const {
      threshold = 0.45,
      topK = 5,
      includeTypes = ["character", "item", "setting", "faction"],
    } = options;

    logger.info(EMBEDDING_CONTEXT, "Starting semantic search", {
      queryText,
      novelId,
      options,
    });

    const novel = await databaseService.loadNovel(novelId);
    if (!novel) {
      logger.error(EMBEDDING_CONTEXT, "Novel not found", { novelId });
      return [];
    }

    try {
      // 1. 生成查询向量
      const queryEmbedding = await createEmbedding(queryText);

      // 2. 构建搜索池
      const pool: Array<{
        id: string;
        name: string;
        type: string;
        entity: any;
        embedding: number[];
      }> = [];

      if (includeTypes.includes("character")) {
        novel.characters?.forEach((char) => {
          if (char.embedding && char.embedding.length > 0) {
            pool.push({
              id: char.id,
              name: char.name,
              type: "character",
              entity: char,
              embedding: char.embedding,
            });
          }
        });
      }

      if (includeTypes.includes("item")) {
        novel.items?.forEach((item) => {
          if (item.embedding && item.embedding.length > 0) {
            pool.push({
              id: item.id,
              name: item.name,
              type: "item",
              entity: item,
              embedding: item.embedding,
            });
          }
        });
      }

      if (includeTypes.includes("setting")) {
        novel.settings?.forEach((setting) => {
          if (setting.embedding && setting.embedding.length > 0) {
            pool.push({
              id: setting.id,
              name: setting.name,
              type: "setting",
              entity: setting,
              embedding: setting.embedding,
            });
          }
        });
      }

      if (includeTypes.includes("faction")) {
        novel.factions?.forEach((faction) => {
          if (faction.embedding && faction.embedding.length > 0) {
            pool.push({
              id: faction.id,
              name: faction.name,
              type: "faction",
              entity: faction,
              embedding: faction.embedding,
            });
          }
        });
      }

      if (pool.length === 0) {
        logger.warn(EMBEDDING_CONTEXT, "No entities with embeddings found");
        return [];
      }

      // 3. 计算相似度
      const scored = pool.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        score: cosineSimilarity(queryEmbedding, item.embedding),
        entity: item.entity,
      }));

      // 4. 过滤和排序
      const filtered = scored.filter((s) => s.score > threshold);
      const sorted = filtered.sort((a, b) => b.score - a.score);
      const results = sorted.slice(0, topK);

      // 构建topResults数组用于日志
      const topResults = results.map(
        (r) => `${r.name}(${r.type})=${r.score.toFixed(2)}`
      );

      logger.success(EMBEDDING_CONTEXT, "Semantic search completed", {
        queryText,
        poolSize: pool.length,
        filteredCount: filtered.length,
        resultCount: results.length,
        topResults,
      });

      return results;
    } catch (error) {
      logger.error(EMBEDDING_CONTEXT, "Semantic search failed", { error });
      return [];
    }
  },

  /**
   * 计算两个向量的余弦相似度
   * @param vecA 向量A
   * @param vecB 向量B
   * @returns 相似度值
   */
  calculateSimilarity(vecA: number[], vecB: number[]): number {
    return cosineSimilarity(vecA, vecB);
  },
};

// 保持向后兼容的导出
export async function generateEmbedding(text: string): Promise<number[]> {
  return createEmbedding(text);
}

export function calculateSimilarity(vecA: number[], vecB: number[]): number {
  return cosineSimilarity(vecA, vecB);
}

/**
 * 查找相关角色 (向后兼容)
 * @deprecated 建议使用 embeddingService.semanticSearch
 */
export async function findRelevantCharacters(
  queryText: string,
  characters: Character[],
  threshold = 0.5,
  topK = 2
): Promise<Character[]> {
  if (characters.length === 0) return [];

  try {
    // 生成查询文本的嵌入向量
    const queryEmbedding = await generateEmbedding(queryText);

    // 为所有角色生成嵌入向量
    const characterEmbeddings = await Promise.all(
      characters.map((char) =>
        generateEmbedding(`${char.name}: ${char.description}`)
      )
    );

    // 计算每个角色与查询的相似度
    const scoredCharacters = characters
      .map((char, index) => ({
        ...char,
        score: cosineSimilarity(queryEmbedding, characterEmbeddings[index]),
      }))
      .filter((char) => char.score > threshold); // 过滤低于阈值的角色

    // 按相似度降序排序
    scoredCharacters.sort((a, b) => b.score - a.score);

    // 返回前 topK 个最相关的角色
    return scoredCharacters.slice(0, topK);
  } catch (error) {
    console.error("Error finding relevant characters:", error);
    return [];
  }
}
