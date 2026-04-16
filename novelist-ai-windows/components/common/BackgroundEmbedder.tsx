import React, { useEffect, useRef } from "react";
import { useEmbeddingStore } from "../../stores/useEmbeddingStore";
import { createEmbedding } from "../../services/llmService";
import { databaseService, db } from "../../lib/storage/db";
import { logger } from "../../lib/logging";

/**
 * 后台向量化处理器
 * 利用 requestIdleCallback 在不阻塞 UI 的情况下处理 Embedding
 */
export const BackgroundEmbedder: React.FC = () => {
  const { queue, popTask, retryTask, isProcessing, setProcessing } =
    useEmbeddingStore();
  const processingRef = useRef(false); // Ref 用于在闭包中保持状态

  useEffect(() => {
    // 如果队列为空或正在处理，直接返回
    if (queue.length === 0 || processingRef.current) return;

    const processNext = async (deadline: IdleDeadline) => {
      // 只要有剩余时间且队列不为空
      while (
        deadline.timeRemaining() > 1 &&
        useEmbeddingStore.getState().queue.length > 0
      ) {
        processingRef.current = true;
        setProcessing(true);

        const task = popTask();
        if (!task) break;

        try {
          logger.debug(
            "BackgroundEmbedder",
            `Processing ${task.type}:${task.id}`
          );

          // 1. 调用 LLM API 生成向量 (这一步是耗时操作)
          const embedding = await createEmbedding(task.content);

          // 2. 保存回数据库
          if (embedding) {
            const timestamp = Date.now();
            // 根据类型更新不同的表
            switch (task.type) {
              case "character":
                await db.characters.update(task.id, {
                  embedding,
                  lastEmbedded: timestamp,
                });
                break;
              case "item":
                await db.items.update(task.id, {
                  embedding,
                  lastEmbedded: timestamp,
                });
                break;
              case "setting":
                await db.settings.update(task.id, {
                  embedding,
                  lastEmbedded: timestamp,
                });
                break;
              case "faction":
                await db.factions.update(task.id, {
                  embedding,
                  lastEmbedded: timestamp,
                });
                break;
            }
            logger.success(
              "BackgroundEmbedder",
              `Updated embedding for ${task.id}`
            );
          }
        } catch (error) {
          logger.error("BackgroundEmbedder", "Failed to embed", error);
          // 失败重试（放回队尾）
          retryTask(task);
        }
      }

      processingRef.current = false;
      setProcessing(false);
    };

    // 注册空闲回调
    const handle = window.requestIdleCallback(processNext, { timeout: 2000 });

    return () => window.cancelIdleCallback(handle);
  }, [queue.length, popTask, retryTask, setProcessing]); // 依赖 queue.length 触发

  return null; // 无 UI
};
