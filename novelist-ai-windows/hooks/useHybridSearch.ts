import { useState, useEffect } from "react";
import { useDebounce } from "./useDebounce";
import { contextEngineService } from "../services/contextEngineService";
import { useUiStore } from "../stores/useUiStore";
import { logger } from "../lib/logging";

interface HybridSearchResult {
  id: string;
  name: string;
  type: "character" | "item" | "setting" | "faction";
  score: number;
  reason: string[];
}

export function useHybridSearch(query: string) {
  const [results, setResults] = useState<HybridSearchResult[]>([]);
  const [isSearchingVector, setIsSearchingVector] = useState(false);
  const [keywordResults, setKeywordResults] = useState<HybridSearchResult[]>(
    []
  );
  const currentNovelTitle = useUiStore((s) => s.currentNovelTitle);

  // 1. 实时响应：关键词匹配 (Local Regex)
  // 只要 query 变，立刻跑，0延迟
  useEffect(() => {
    if (!query.trim() || !currentNovelTitle) {
      setResults([]);
      setKeywordResults([]);
      return;
    }

    const runKeywordSearch = async () => {
      try {
        // 使用智能实体解析获取关键词匹配结果
        const parsedEntities =
          await contextEngineService.intelligentEntityParsing(query);

        // 转换为结果格式（这里简化，实际需要查询数据库获取完整信息）
        const keywordMatches: HybridSearchResult[] = [];

        // 这里需要实际的数据库查询来获取实体详情
        // 为了演示，我们使用简化的逻辑
        if (parsedEntities.characters.length > 0) {
          parsedEntities.characters.forEach((name) => {
            keywordMatches.push({
              id: `char-${name}`,
              name,
              type: "character",
              score: 1.0,
              reason: ["keyword_match"],
            });
          });
        }

        if (parsedEntities.items.length > 0) {
          parsedEntities.items.forEach((name) => {
            keywordMatches.push({
              id: `item-${name}`,
              name,
              type: "item",
              score: 1.0,
              reason: ["keyword_match"],
            });
          });
        }

        if (parsedEntities.settings.length > 0) {
          parsedEntities.settings.forEach((name) => {
            keywordMatches.push({
              id: `setting-${name}`,
              name,
              type: "setting",
              score: 1.0,
              reason: ["keyword_match"],
            });
          });
        }

        if (parsedEntities.factions.length > 0) {
          parsedEntities.factions.forEach((name) => {
            keywordMatches.push({
              id: `faction-${name}`,
              name,
              type: "faction",
              score: 1.0,
              reason: ["keyword_match"],
            });
          });
        }

        setKeywordResults(keywordMatches);
        setResults(keywordMatches);

        logger.debug("useHybridSearch", "Keyword search completed", {
          query,
          results: keywordMatches.length,
        });
      } catch (error) {
        logger.error("useHybridSearch", "Keyword search failed", error);
      }
    };

    runKeywordSearch();
  }, [query, currentNovelTitle]);

  // 2. 延迟响应：向量检索 (Debounced)
  // 2秒防抖，用户停下来思考时再偷偷去查向量
  const debouncedQuery = useDebounce(query, 2000);

  useEffect(() => {
    if (!debouncedQuery.trim() || !currentNovelTitle) return;

    const runVectorSearch = async () => {
      setIsSearchingVector(true);
      try {
        logger.debug("useHybridSearch", "Starting vector search", {
          query: debouncedQuery,
        });

        // 使用增强的语义检索（包含向量检索和重排序）
        const entityIds = await contextEngineService.semanticRetrieve(
          debouncedQuery,
          currentNovelTitle
        );

        // 这里需要根据ID获取完整的实体信息来构建结果
        // 为了演示，我们构建一个简化的结果集
        const vectorResults: HybridSearchResult[] = entityIds.map(
          (id, index) => ({
            id,
            name: `Entity-${id}`,
            type: "character", // 简化处理
            score: 0.8 - index * 0.1, // 模拟递减的相似度分数
            reason: ["vector_match", "context_aware_reranking"],
          })
        );

        // 合并关键词和向量结果，去重并按分数排序
        const combinedResults = [...keywordResults];

        // 添加向量结果中不存在于关键词结果的项目
        vectorResults.forEach((vectorResult) => {
          if (!combinedResults.find((r) => r.id === vectorResult.id)) {
            combinedResults.push(vectorResult);
          }
        });

        // 按分数排序
        combinedResults.sort((a, b) => b.score - a.score);

        setResults(combinedResults.slice(0, 5)); // 只取前5个结果

        logger.success("useHybridSearch", "Vector search completed", {
          query: debouncedQuery,
          vectorResults: vectorResults.length,
          finalResults: combinedResults.length,
        });
      } catch (error) {
        logger.error("useHybridSearch", "Vector search failed", error);
      } finally {
        setIsSearchingVector(false);
      }
    };

    runVectorSearch();
  }, [debouncedQuery, currentNovelTitle, keywordResults]);

  return {
    results,
    isSearchingVector,
    keywordResults,
    hasVectorResults: results.some((r) => r.reason.includes("vector_match")),
  };
}
