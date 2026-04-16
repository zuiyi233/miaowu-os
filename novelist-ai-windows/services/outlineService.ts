import { OutlineNode } from "../types";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useStyleStore } from "../stores/useStyleStore"; // ✅ 引入 StyleStore
import { toast } from "sonner";
import { logger } from "../lib/logging";
import { getModelSpec } from "../src/lib/constants/modelSpecs";
import type { Novel, Chapter, Character, Faction, Setting } from "../types";
// ✅ 引入兼容性服务
import { styleCompatibilityService } from "./styleCompatibilityService";
// ✅ 引入新的工具函数
import { safeJsonParse, validateJsonStructure } from "../lib/utils/jsonRepair";
import { injectCompatibilityIntoPrompt } from "../lib/utils/promptInjection";
import {
  generationLogger,
  createUserFriendlyMessage,
} from "../lib/utils/generationLogger";

// ✅ 新增：定义上下文数据接口
export interface WorldContextData {
  characters?: Character[];
  factions?: Faction[];
  settings?: Setting[];
}

// ==========================================
// 1. 核心配置区 (数学模型对齐)
// ==========================================

// 批次大小：10章是一个兼顾 Token 限制与上下文连贯性的最佳平衡点
const BATCH_SIZE = 10;

// 篇幅映射配置 (完全对齐你的要求)
const WORD_COUNT_CONFIG: Record<
  string,
  { totalChapters: number; description: string; densityPrompt: string }
> = {
  short: {
    totalChapters: 20, // 20万字 -> 20章 (干货)
    description: "短篇 (20万字)",
    densityPrompt:
      "【极速节奏】：本书篇幅短，剧情必须极其紧凑。拒绝任何注水和无关支线。每一章都要有强冲突。前10章完成铺垫与发展，后10章完成高潮与结局。",
  },
  medium: {
    totalChapters: 80, // 100万字 -> 80章 (标准单卷)
    description: "中篇 (100万字)",
    densityPrompt:
      "【标准节奏】：网文黄金节奏。每卷是一个完整的大副本。前15章铺垫，中间50章波折反转（需要2-3个小高潮），最后15章大决战。",
  },
  long: {
    totalChapters: 100, // 300万字 -> 100章 (高密度)
    description: "长篇 (300万字)",
    densityPrompt:
      "【长篇布局】：剧情密度极高。需要草蛇灰线，伏笔千里。支线人物要有高光。不要急于推进主线，充分展示世界观和人物羁绊。",
  },
  epic: {
    totalChapters: 120, // 1000万字 -> 120章 (史诗级)
    description: "史诗 (1000万字+)",
    densityPrompt:
      "【史诗宏大】：这不仅是故事，是世界编年史。单卷即是一部完整小说。节奏要稳，细节要丰满。允许慢热，允许大量的环境与心理侧写，铺垫要深厚。",
  },
};

// ==========================================
// 2. 智能辅助函数
// ==========================================

// 动态相位指令 (Pacing Engine)
function getPhaseInstruction(batchIndex: number, totalBatches: number): string {
  const progress = (batchIndex + 1) / totalBatches;
  const isFirstBatch = batchIndex === 0;
  const isLastBatch = batchIndex === totalBatches - 1;

  // 1. 开篇
  if (isFirstBatch) {
    return `【当前阶段：开局与破题 (第 1-${BATCH_SIZE} 章)】
任务：
1. **黄金三章**：前三章必须抛出核心悬念或冲突（退婚/死局/金手指觉醒）。
2. **切入点**：快速确立主角的当前困境和本卷的终极目标。
3. **节奏**：作为本卷开头，吸引力是第一位的。`;
  }

  // 2. 结局
  if (isLastBatch) {
    return `【当前阶段：高潮与收束 (倒数 ${BATCH_SIZE} 章)】
任务：
1. **终极爆发**：收束本卷所有伏笔，主角与本卷最终BOSS决战。
2. **情绪释放**：爽点达到最高峰，所有的压抑在这里彻底释放。
3. **钩子**：解决本卷危机的同时，引出下一卷的地图或新危机。`;
  }

  // 3. 铺垫期 (前 25%)
  if (progress <= 0.25) {
    return `【当前阶段：探索与铺垫 (进度 ${(progress * 100).toFixed(0)}%)】
任务：
1. **世界观展开**：随着主角脚步探索新地图，引入新配角。
2. **小试牛刀**：安排1-2个小冲突，展示主角的初步成长。
3. **压节奏**：不要急着推主线，丰富细节。`;
  }

  // 4. 发展期 (中段 25%-75%)
  if (progress <= 0.75) {
    return `【当前阶段：矛盾激化与转折 (进度 ${(progress * 100).toFixed(0)}%)】
任务：
1. **危机升级**：反派开始针对主角，局势变得复杂。
2. **支线汇聚**：之前的伏笔开始发挥作用。
3. **抑扬顿挫**：安排"主角吃瘪"或"战略转移"的情节，为后文打脸蓄力。`;
  }

  // 5. 爆发前夕 (后段 75%-99%)
  return `【当前阶段：暴风雨前的宁静 (进度 ${(progress * 100).toFixed(0)}%)】
任务：
1. **决战前夕**：整理装备，提升境界，集结盟友。
2. **情绪积累**：反派的嚣张达到顶点，读者期待值拉满。
3. **导火索**：发生一个关键事件（如亲友受伤），直接引爆最终决战。`;
}

// 章节清洗与重编号
function renumberChapters(chapters: any[]): any[] {
  return chapters.map((ch, idx) => ({
    ...ch,
    // 移除 AI 可能生成的 "第x章"、"Chapter 1" 等前缀，统一格式
    title: `第${idx + 1}章：${ch.title
      .replace(
        /^(第[0-9一二三四五六七八九十]+[章节]\s*[:：.-]?\s*|[0-9]+\.\s*|Chapter\s*[0-9]+\s*[:：.-]?\s*)/i,
        ""
      )
      .trim()}`,
  }));
}

// ✅ 新增：权重表与 Prompt 组装工厂
function buildWorldContextPrompt(
  data: WorldContextData,
  maxTokens = 2000
): string {
  if (!data) return "";

  let contextText = "";
  let currentTokens = 0;

  // 1. 角色 (权重最高)
  if (data.characters && data.characters.length > 0) {
    contextText += "【已知核心角色】:\n";
    // 简单的权重排序：主角 > 反派 > 配角 (假设 role 字段有这些值，或者是简单的顺序)
    // 这里简化处理，假设传入的顺序已经是优化过的，或者直接遍历
    for (const char of data.characters) {
      const charDesc = `- ${char.name} (${char.age || "未知"}, ${
        char.gender || "未知"
      }): ${char.description || "暂无简介"}\n`;
      // 简单的 Token 估算 (1汉字 ≈ 2 token)
      const estimatedCost = charDesc.length * 2;

      if (currentTokens + estimatedCost > maxTokens) {
        contextText += "...(部分次要角色因篇幅省略)\n";
        break;
      }
      contextText += charDesc;
      currentTokens += estimatedCost;
    }
    contextText += "\n";
  }

  // 2. 势力 (权重次之)
  if (data.factions && data.factions.length > 0 && currentTokens < maxTokens) {
    contextText += "【主要势力】:\n";
    for (const fac of data.factions) {
      const facDesc = `- ${fac.name}: ${fac.description || "暂无简介"}\n`;
      const estimatedCost = facDesc.length * 2;
      if (currentTokens + estimatedCost > maxTokens) break;
      contextText += facDesc;
      currentTokens += estimatedCost;
    }
    contextText += "\n";
  }

  // 3. 场景/设定 (权重最低)
  if (data.settings && data.settings.length > 0 && currentTokens < maxTokens) {
    contextText += "【主要场景设定】:\n";
    for (const setting of data.settings) {
      const settingDesc = `- ${setting.name} (${setting.type || "其他"}): ${
        setting.description || "暂无简介"
      }\n`;
      const estimatedCost = settingDesc.length * 2;
      if (currentTokens + estimatedCost > maxTokens) break;
      contextText += settingDesc;
      currentTokens += estimatedCost;
    }
    contextText += "\n";
  }

  if (!contextText.trim()) return "";

  return `<WorldContext>\n${contextText}</WorldContext>\n请在生成大纲时严格遵守上述人设与世界观设定，保持逻辑连贯。\n`;
}

// 定义流式回调接口
interface StreamCallbacks {
  onMessage: (content: string) => void;
  onReasoning?: (content: string) => void;
  onThinking?: (isThinking: boolean) => void;
  onUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
  onError?: (error: Error) => void;
  onFinish?: () => void;
}

// 复制 llmService 中的核心函数
async function executeRequest(
  baseUrl: string,
  endpoint: string,
  options: RequestInit,
  apiKey: string
) {
  // 1. 清理 Base URL 和 Endpoint，防止双斜杠
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const cleanEndpoint = endpoint.replace(/^\/+/, "");

  // 2. 构建完整 URL
  let fullUrl = `${cleanBaseUrl}/${cleanEndpoint}`;

  try {
    const urlObj = new URL(fullUrl);

    // 3. 判断是否需要走代理
    // 如果不是本地地址，则通过 /api/proxy 转发
    if (
      !urlObj.hostname.includes("localhost") &&
      !urlObj.hostname.includes("127.0.0.1")
    ) {
      const relativePath = urlObj.pathname + urlObj.search;
      // 确保参数连接符正确
      const separator = relativePath.includes("?") ? "&" : "?";

      // ✅ 修复：确保 target 被正确编码，且路径清晰
      fullUrl = `/api/proxy${relativePath}${separator}__target=${encodeURIComponent(
        urlObj.origin
      )}`;
    }
  } catch (e) {
    console.error("URL 解析错误:", e);
    // 如果 URL 解析失败，尝试直接请求（虽然可能跨域）
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...((options.headers as any) || {}),
  };

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    try {
      const json = JSON.parse(errorText);
      throw new Error(
        json.error?.message || json.message || `HTTP ${response.status}`
      );
    } catch {
      throw new Error(
        `API 请求失败: ${response.status} - ${errorText.slice(0, 100)}`
      );
    }
  }

  return response;
}

// 流式解析状态机
class StreamParser {
  private buffer = "";
  private inThinkingBlock = false;

  constructor(private callbacks: StreamCallbacks) {}

  processChunk(delta: any, fullJson?: any) {
    // 1. ✅ 全面扫描所有可能的思考字段
    // 不同的服务商可能会映射到不同的字段
    const reasoningContent =
      delta.reasoning_content ||
      delta.reasoning ||
      delta.thinking ||
      delta.thoughts ||
      delta.thought;

    if (reasoningContent) {
      this.callbacks.onReasoning?.(reasoningContent);
      this.callbacks.onThinking?.(true);
      return;
    }

    // 2. 处理正文内容 (可能包含 </think> 标签)
    const content = delta.content || "";
    if (!content) return;

    // --- 智能标签解析逻辑 ---
    this.buffer += content;

    // 检查是否进入 </think> 块
    if (!this.inThinkingBlock) {
      const startIndex = this.buffer.indexOf("</think>");

      if (startIndex !== -1) {
        this.inThinkingBlock = true;
        this.callbacks.onThinking?.(true);

        // 发送标签之前的内容
        if (startIndex > 0) {
          const preContent = this.buffer.slice(0, startIndex);
          this.callbacks.onMessage(preContent);
        }

        // 截断缓冲区
        this.buffer = this.buffer.slice(startIndex + 7); // </think> length is 7
      } else {
        // 没有发现开始标签，安全发送
        if (this.buffer.length > 7) {
          const safeLength = this.buffer.length - 7;
          const chunkToSend = this.buffer.slice(0, safeLength);
          this.callbacks.onMessage(chunkToSend);
          this.buffer = this.buffer.slice(safeLength);
        }
        return;
      }
    }

    // 正在思考块中
    if (this.inThinkingBlock) {
      const endIndex = this.buffer.indexOf("</think>");

      if (endIndex !== -1) {
        // 发现了结束标签
        const thought = this.buffer.slice(0, endIndex);
        if (thought) this.callbacks.onReasoning?.(thought);

        this.inThinkingBlock = false;
        this.callbacks.onThinking?.(false);

        const remaining = this.buffer.slice(endIndex + 8); // </think> length is 8
        this.buffer = "";
        if (remaining) {
          this.callbacks.onMessage(remaining);
        }
      } else {
        // 还在思考中
        if (this.buffer.length > 8) {
          const safeLength = this.buffer.length - 8;
          const chunkToSend = this.buffer.slice(0, safeLength);
          this.callbacks.onReasoning?.(chunkToSend);
          this.buffer = this.buffer.slice(safeLength);
        }
      }
    }
  }

  // ✅ 新增：处理 Usage
  processUsage(usage: any) {
    if (usage) {
      this.callbacks.onUsage?.(usage);
    }
  }

  flush() {
    if (this.buffer) {
      if (this.inThinkingBlock) {
        this.callbacks.onReasoning?.(this.buffer);
      } else {
        this.callbacks.onMessage(this.buffer);
      }
    }
    this.callbacks.onThinking?.(false);
  }
}

async function fetchChatCompletion(
  messages: any[],
  taskType: keyof ReturnType<typeof useSettingsStore.getState>["modelSettings"],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  isRetry: boolean = false
) {
  const state = useSettingsStore.getState();
  const modelConfig = state.modelSettings[taskType];
  const provider = state.providers.find((p) => p.id === modelConfig.providerId);

  if (!provider) {
    const errorMsg = `未找到 ${taskType} 任务的有效服务商配置`;
    toast.error(errorMsg);
    logger.error("OutlineService", errorMsg);
    throw new Error(errorMsg);
  }

  logger.info("OutlineService", `Starting ${taskType} task`, {
    model: modelConfig.model,
    provider: provider.name,
  });

  // ✅ 核心修复：获取模型规格并进行参数清洗
  const spec = getModelSpec(modelConfig.model);

  // 1. 智能调整 max_tokens
  // 如果用户设置的值超过了模型已知上限，则强制降级
  let safeMaxTokens = (modelConfig as any).maxTokens;
  if (safeMaxTokens > spec.maxOutput) {
    console.warn(
      `[OutlineService] Requested max_tokens (${safeMaxTokens}) exceeds model limit (${spec.maxOutput}). Clamping.`
    );
    safeMaxTokens = spec.maxOutput;
  }

  const body: any = {
    model: modelConfig.model,
    messages: messages,
    stream: true,
    temperature: (modelConfig as any).temperature,
    max_tokens: safeMaxTokens, // ✅ 使用安全的 Token 数值
    top_p: (modelConfig as any).topP,
    frequency_penalty: (modelConfig as any).frequencyPenalty,
    presence_penalty: (modelConfig as any).presencePenalty,
    // ✅ 必填参数：强制要求返回 usage，这通常会触发 NewAPI 返回完整的 reasoning_content
    stream_options: { include_usage: true },
  };

  if (modelConfig.model.includes("gemini") && (modelConfig as any).topK) {
    body.top_k = (modelConfig as any).topK;
  }

  logger.debug("OutlineService", "Request Payload", body);

  try {
    const response = await executeRequest(
      provider.baseUrl,
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify(body),
        signal,
      },
      provider.apiKey
    );

    if (!response.body) throw new Error("ReadableStream not supported");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const parser = new StreamParser(callbacks);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const jsonStr = trimmed.slice(6);
            const json = JSON.parse(jsonStr);

            // ✅ 捕获 usage (通常在流的最后，delta 为空但 usage 存在)
            if (json.usage) {
              parser.processUsage(json.usage);
            }

            const delta = json.choices?.[0]?.delta;

            if (delta) {
              parser.processChunk(delta);
            }
          } catch (e) {
            // 忽略非 JSON 行
          }
        }
      }
    }

    parser.flush();
    logger.success("OutlineService", "Stream finished");
    callbacks.onFinish?.();
  } catch (error: any) {
    if (error.name === "AbortError") {
      logger.warn("OutlineService", "Request aborted");
      return;
    }

    logger.error("OutlineService", "Request Failed", error);
    callbacks.onError?.(error);
    toast.error(`AI 请求失败: ${error.message}`);
  }
}

// 辅助函数：从 Markdown 代码块中提取 JSON（已升级为鲁棒性解析）
function parseJsonOutput(
  text: string,
  expectedStructure: "volumeArray" | "chapterArray" = "volumeArray"
) {
  // 使用新的鲁棒性解析工具
  const parsedData = safeJsonParse(text, {
    enableRepair: true,
    fallbackToTextExtraction: true,
  });

  if (!parsedData) {
    return null;
  }

  // 验证数据结构
  const validation = validateJsonStructure(parsedData, expectedStructure);
  if (!validation.isValid) {
    logger.error("OutlineService", `JSON结构验证失败: ${validation.error}`);
    return null;
  }

  return parsedData;
}

// 生成卷列表 (Top Level) - 已升级为鲁棒性版本
export async function generateVolumes(
  novelTitle: string,
  prompt: string,
  selectedGenres: string[] = [], // ✅ 新增：选中的题材ID
  selectedTags: string[] = [], // ✅ 新增：选中的标签ID
  contextData?: WorldContextData, // 👈 新增参数
  onMessage?: (msg: string) => void
): Promise<{ title: string; desc: string }[] | null> {
  // ✅ 1. 从 Store 获取当前激活的文风配置
  const { getActiveStyle, activeStyleId } = useStyleStore.getState();
  const activeStyle = getActiveStyle();
  const stylePrompt = activeStyle.systemPrompt;

  // ✅ 2. 检查兼容性并生成调和指令
  const compatibility = styleCompatibilityService.checkCompatibility(
    activeStyleId,
    selectedGenres,
    selectedTags
  );

  // ✅ 3. 构建世界观上下文
  const worldContextPrompt = contextData
    ? buildWorldContextPrompt(contextData)
    : "";

  // ✅ 4. 构建基础System Prompt
  const baseSystemPrompt = `你是一位殿堂级网文大纲架构师。

【文风协议 (最高优先级)】：
${stylePrompt}

${worldContextPrompt} // 👈 注入世界观上下文

【任务目标】：
请根据上述文风、世界观和用户的创意要求，规划小说的【分卷大纲】。

【老编辑的铁律】：
1. **字数规划要狠**：短篇20万字？那就别搞什么支线。长篇300万字？必须地图换图，力量体系升级。
2. **题材要有魂**：玄幻是"逆天改命"，都市是"反差打脸"，悬疑是"未知恐惧"。
3. **拒绝AI八股**：别用"殊不知"、"然而"、"竟然"这种词。多用短句，写出紧迫感。
4. **JSON输出要干净**：只输出JSON数组，别废话。格式如下：
[
  { "title": "第一卷：潜龙勿用", "desc": "主角在新手村的成长，获得金手指..." },
  { "title": "第二卷：见龙在田", "desc": "主角进入大世界的冒险，遭遇第一个大反派..." }
]

现在，开始你的表演。`;

  // ✅ 5. 注入兼容性指令
  const systemPrompt = injectCompatibilityIntoPrompt(
    baseSystemPrompt,
    compatibility,
    selectedGenres,
    selectedTags
  );

  // ✅ 6. 获取模型配置用于日志记录
  const state = useSettingsStore.getState();
  const modelConfig = state.modelSettings.outline;
  const provider = state.providers.find((p) => p.id === modelConfig.providerId);

  // ✅ 7. 开始生成日志记录
  const logId = generationLogger.startGeneration(
    "volumes",
    {
      novelTitle,
      prompt,
      selectedGenres,
      selectedTags,
      systemPrompt,
    },
    modelConfig.model,
    provider?.name || "Unknown"
  );

  let fullContent = "";
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      await fetchChatCompletion(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `小说标题：${novelTitle}\n创意要求：${prompt}`,
          },
        ],
        "outline", // 使用 outline 专用的模型配置
        {
          onMessage: (chunk) => {
            fullContent += chunk;
            if (onMessage) onMessage(fullContent);
          },
          onUsage: (usage) => {
            generationLogger.logTokenUsage(logId, {
              prompt: usage.prompt_tokens,
              completion: usage.completion_tokens,
              total: usage.total_tokens,
            });
          },
        }
      );

      // ✅ 8. 记录原始输出
      generationLogger.logRawOutput(logId, fullContent);

      // ✅ 9. 使用鲁棒性解析
      const result = parseJsonOutput(fullContent, "volumeArray");

      if (!result) {
        throw new Error("AI生成的内容格式不正确，请重试");
      }

      if (!Array.isArray(result)) {
        throw new Error("AI生成的内容格式不正确，请重试");
      }

      // ✅ 10. 记录成功结果
      generationLogger.logParsingResult(logId, result, true);
      generationLogger.completeGeneration(logId);

      return result;
    } catch (error: any) {
      logger.error(
        "OutlineService",
        `生成卷列表失败 (尝试 ${retryCount + 1}/${maxRetries + 1})`,
        error
      );

      // ✅ 11. 分析错误并记录
      const generationError = generationLogger.analyzeError(error, fullContent);
      generationLogger.logParsingResult(
        logId,
        null,
        false,
        generationError.message,
        retryCount
      );

      // ✅ 12. 如果是可恢复错误且还有重试机会，则重试
      if (generationError.recoverable && retryCount < maxRetries) {
        retryCount++;
        generationLogger.logRetry(logId);
        fullContent = ""; // 重置内容
        continue;
      }

      // ✅ 13. 显示用户友好的错误信息
      const userMessage = createUserFriendlyMessage(
        generationError,
        fullContent
      );
      toast.error(userMessage);

      generationLogger.completeGeneration(logId);
      throw error;
    }
  }

  return null;
}

// ==========================================
// 3. 核心生成逻辑 (Infinite Stream Batch Generation)
// ==========================================

/**
 * 生成特定卷的章节 - 支持中断和长生成
 */
export async function generateChaptersForVolume(
  novelTitle: string,
  volumeTitle: string,
  volumeDesc: string,
  context: string = "",
  contextData?: WorldContextData,
  wordCountId: string = "medium",
  onMessage?: (msg: string) => void,
  signal?: AbortSignal // ✅ 新增：支持中断信号
): Promise<{ title: string; desc: string }[] | null> {
  // 1. 准备基础配置
  const { getActiveStyle } = useStyleStore.getState();
  const activeStyle = getActiveStyle();
  const stylePrompt = activeStyle.systemPrompt;
  const worldContextPrompt = contextData
    ? buildWorldContextPrompt(contextData)
    : "";

  // 2. 计算批次 (严格对齐你的数学模型)
  const config = WORD_COUNT_CONFIG[wordCountId] || WORD_COUNT_CONFIG.medium;
  const targetTotalChapters = config.totalChapters;
  const totalBatches = Math.ceil(targetTotalChapters / BATCH_SIZE);

  const allChapters: { title: string; desc: string }[] = [];

  // 3. 上下文接龙容器
  // 信任前端传入的 context (前端已经做过筛选)，大幅放宽限制确保容纳上一卷完整结局
  let continuityContext = context
    ? `【前卷/前情提要 (Context Relay)】:\n${context.slice(-40000)}`
    : "";

  // 4. 日志记录
  const modelConfig = useSettingsStore.getState().modelSettings.outline;
  const providerName =
    useSettingsStore
      .getState()
      .providers.find((p) => p.id === modelConfig.providerId)?.name ||
    "Unknown";

  const logId = generationLogger.startGeneration(
    "chapters",
    {
      novelTitle,
      prompt: `分批生成: ${volumeTitle} (${config.description}, 目标${targetTotalChapters}章)`,
      systemPrompt: "Batch Generation V3",
    },
    modelConfig.model,
    providerName
  );

  try {
    // 5. 🔄 批次循环
    for (let i = 0; i < totalBatches; i++) {
      // ✅ 检查中断信号
      if (signal?.aborted) {
        throw new Error("用户终止生成");
      }

      const isLastBatch = i === totalBatches - 1;
      const currentBatchSize = isLastBatch
        ? targetTotalChapters - i * BATCH_SIZE
        : BATCH_SIZE;

      if (currentBatchSize <= 0) break;

      const startChap = i * BATCH_SIZE + 1;
      const endChap = i * BATCH_SIZE + currentBatchSize;

      // UI 通知
      if (onMessage) {
        onMessage(
          `正在构思第 ${
            i + 1
          }/${totalBatches} 阶段 (第 ${startChap}-${endChap} 章)...`
        );
      }

      // 动态指令
      const phaseInstruction = getPhaseInstruction(i, totalBatches);

      // 构建 Prompt
      const prompt = `你是一位殿堂级网文大纲架构师。
当前任务：为长篇小说《${novelTitle}》的卷《${volumeTitle}》设计详细章节。

【整体规划】：
- 目标篇幅：${config.description}
- 本卷总章数：${targetTotalChapters} 章

【文风协议】：
${stylePrompt}

${worldContextPrompt}

【本卷简介】：
${volumeDesc}

${continuityContext}

==================================================
【本批次任务指令 (Batch ${i + 1}/${totalBatches})】：
1. **生成范围**：本卷第 ${startChap} 章 到 第 ${endChap} 章。
2. **生成数量**：${currentBatchSize} 章。
3. **节奏控制**：${phaseInstruction}
4. **密度要求**：${config.densityPrompt}
5. **格式要求**：只输出 JSON 数组。不要包含任何 Markdown 标记。

【JSON 示例】：
[
  { "title": "章节名", "desc": "200字左右的细纲，包含具体冲突和爽点。" },
  ...
]`;

      // 执行生成
      // 注意：传递 signal 给 fetchChatCompletion
      const batchChapters = await executeBatchGeneration(
        prompt,
        i,
        logId,
        signal
      );

      if (batchChapters && batchChapters.length > 0) {
        allChapters.push(...batchChapters);

        // 更新接龙上下文
        const lastFew = batchChapters.slice(-3);
        continuityContext =
          `【上文剧情承接 (截止第${endChap}章)】:\n` +
          lastFew.map((c: any) => `[${c.title}]: ${c.desc}`).join("\n");

        // 记录日志
        generationLogger.logParsingResult(
          logId,
          batchChapters,
          true,
          undefined,
          i
        );

        // 防抖延迟
        if (!isLastBatch)
          await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        // 容错
        toast.error(`第 ${i + 1} 批次生成异常，已自动中断`);
        break;
      }
    }

    // 6. 完成
    generationLogger.completeGeneration(logId);

    // 7. 返回完整结果
    return renumberChapters(allChapters);
  } catch (error: any) {
    // 处理中断逻辑
    if (error.message === "用户终止生成" || error.name === "AbortError") {
      logger.warn("OutlineService", "生成被用户终止");
      toast.info(`生成已停止，保留了前 ${allChapters.length} 章`);
      // 返回已生成的部分，不抛错
      return renumberChapters(allChapters);
    }

    logger.error("OutlineService", "分批生成失败", error);
    const errInfo = generationLogger.analyzeError(error);
    toast.error(`生成中断：${errInfo.userMessage}`);

    // 即使报错，也返回已有的
    if (allChapters.length > 0) {
      return renumberChapters(allChapters);
    }

    throw error;
  }
}

// ✅ 封装单次生成请求
async function executeBatchGeneration(
  prompt: string,
  batchIndex: number,
  logId: string,
  signal?: AbortSignal
): Promise<any[]> {
  let fullContent = "";
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    if (signal?.aborted) throw new Error("用户终止生成");

    try {
      fullContent = "";

      await fetchChatCompletion(
        [
          { role: "system", content: "你是一个只输出 JSON 的小说大纲生成器。" },
          { role: "user", content: prompt },
        ],
        "outline",
        {
          onMessage: (chunk) => {
            fullContent += chunk;
          },
        },
        signal // ✅ 传递 signal
      );

      const result = parseJsonOutput(fullContent, "chapterArray");
      if (Array.isArray(result)) return result;

      throw new Error("非数组格式");
    } catch (e: any) {
      if (e.name === "AbortError" || signal?.aborted) throw e;

      logger.warn(
        "OutlineService",
        `Batch ${batchIndex} retry ${retryCount + 1}`,
        e
      );
      retryCount++;
      if (retryCount > maxRetries) return []; // 失败返回空数组，由上层处理

      await new Promise((r) => setTimeout(r, 1000)); // 重试延迟
    }
  }
  return [];
}

// 将AI生成的数据转换为OutlineNode格式
export function convertVolumesToOutlineNodes(
  volumesData: { title: string; desc: string }[]
): OutlineNode[] {
  return volumesData.map((vol, index) => ({
    id: `temp-vol-${Date.now()}-${index}`,
    type: "volume" as const,
    title: vol.title,
    desc: vol.desc,
    isSelected: true,
    children: [],
    status: "idle",
  }));
}

// 将AI生成的章节数据转换为OutlineNode格式
export function convertChaptersToOutlineNodes(
  chaptersData: { title: string; desc: string }[],
  volumeId: string
): OutlineNode[] {
  return chaptersData.map((ch, index) => ({
    id: `temp-ch-${Date.now()}-${index}`,
    type: "chapter" as const,
    title: ch.title,
    desc: ch.desc,
    parentId: volumeId,
    isSelected: true,
    status: "idle",
  }));
}

// 估算Token消耗（粗略计算）
export function estimateTokens(text: string): number {
  // 粗略估算：中文字符约等于1.5个token，英文单词约等于1个token
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords);
}

// 简单的 Token 估算
export function estimateGenerationTokens(
  novelTitle: string,
  prompt: string,
  type: "volumes" | "chapters"
) {
  const inputLength = novelTitle.length + prompt.length + 500; // 加上 System Prompt 预估
  // 输出预估：卷列表约 1k-2k，章节列表约 2k-4k
  const outputLength = type === "volumes" ? 2000 : 4000;

  return {
    input: Math.ceil(inputLength / 2), // 粗略估算
    output: outputLength,
  };
}

// ✅ 核心函数：将数据库小说结构转换为大纲树
export function convertNovelToOutlineTree(novel: Novel): OutlineNode[] {
  const tree: OutlineNode[] = [];

  // 1. 处理卷 (Volumes)
  novel.volumes?.forEach((vol) => {
    const volNode: OutlineNode = {
      id: vol.id,
      type: "volume",
      title: vol.title,
      desc: vol.description || "",
      isSelected: true, // 默认选中，表示已存在
      status: "idle",
      children: [],
    };

    // 2. 处理卷内的章节
    // 注意：loadNovel 已经帮我们把 chapters 组装到了 volume.chapters 里
    // 但为了保险，我们也可以去 novel.chapters 里找匹配 volumeId 的
    const volumeChapters =
      novel.chapters?.filter((c) => c.volumeId === vol.id) || [];

    // ✅ 按数据库中的 order 字段排序，确保章节顺序正确
    const sortedChapters = volumeChapters.sort((a, b) => {
      // 如果有 order 字段，按 order 排序
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      // 如果没有 order 字段，按标题排序作为后备方案
      return a.title.localeCompare(b.title);
    });

    sortedChapters.forEach((ch) => {
      volNode.children?.push({
        id: ch.id,
        type: "chapter",
        title: ch.title,
        desc: ch.description || "", // 💡 直接从新的 description 字段读取细纲
        parentId: vol.id,
        isSelected: true,
        status: "idle",
      });
    });

    tree.push(volNode);
  });

  // 3. (可选) 处理未归类章节 (没有 volumeId 的)
  const orphanChapters = novel.chapters?.filter((c) => !c.volumeId) || [];
  if (orphanChapters.length > 0) {
    // 创建一个虚拟卷或直接放在根目录（取决于你的 UI 支持）
    // 这里简单处理：创建一个"未分类"卷
    const orphanVol: OutlineNode = {
      id: "orphan-vol",
      type: "volume",
      title: "未分类章节",
      desc: "暂无卷属的章节",
      isSelected: true,
      status: "idle",
      children: orphanChapters.map((ch) => ({
        id: ch.id,
        type: "chapter",
        title: ch.title,
        desc: ch.description || "", // 💡 直接从新的 description 字段读取细纲
        isSelected: true,
        status: "idle",
      })),
    };
    tree.push(orphanVol);
  }

  return tree;
}

// ==========================================
// 4. 动态校准系统 (Dynamic Calibration System)
// ==========================================

/**
 * 🧠 智能校准：根据前文的实际剧情，修正当前卷的【卷纲要】
 * 场景：用户写完了第一卷，发现剧情跑偏了，需要 AI 重新规划第二卷的主旨，而不是直接硬写章节。
 */
export async function calibrateVolumeInfo(
  novelTitle: string,
  targetVolumeTitle: string,
  originalVolumeDesc: string, //原本的计划
  previousContext: string, // 真实的上一卷结局
  onMessage?: (msg: string) => void
): Promise<{ newDesc: string; reason: string } | null> {
  const prompt = `你是一位网文主编。
作者正在创作长篇小说《${novelTitle}》。
现在准备开始写【${targetVolumeTitle}】。

【原本的大纲计划】：
${originalVolumeDesc}

【实际发生的剧情（前卷结局）】：
${previousContext}

【任务】：
请分析"实际剧情"与"原本计划"是否存在逻辑断层或冲突？
1. 如果"实际剧情"发生了重大偏转（如核心配角死亡、金手指升级、地图更换），请**大幅修改**本卷的大纲，使其承接实际剧情。
2. 如果基本一致，请**细化**本卷大纲，使其更具张力。

【输出格式（JSON）】：
{
  "newDesc": "修正后的本卷剧情总纲（300字左右），包含核心冲突、主要爽点和结局走向。",
  "reason": "简述修改原因（例如：因上一卷反派提前死亡，本卷反派调整为...）"
}
`;

  // 获取模型配置
  const modelConfig = useSettingsStore.getState().modelSettings.outline;
  const providerName =
    useSettingsStore
      .getState()
      .providers.find((p) => p.id === modelConfig.providerId)?.name ||
    "Unknown";

  // 启动日志
  const logId = generationLogger.startGeneration(
    "volumes", // 使用 volumes 类型，因为校准的是卷信息
    {
      novelTitle,
      prompt: `校准: ${targetVolumeTitle}`,
      systemPrompt: "Volume Calibration V1",
    },
    modelConfig.model,
    providerName
  );

  let fullContent = "";
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      if (onMessage) {
        onMessage("正在分析前文剧情，校准大纲方向...");
      }

      await fetchChatCompletion(
        [
          {
            role: "system",
            content: "你是一个只输出 JSON 的网文编辑，擅长剧情校准和逻辑修复。",
          },
          { role: "user", content: prompt },
        ],
        "outline",
        {
          onMessage: (chunk) => {
            fullContent += chunk;
          },
        }
      );

      // 解析结果
      const result = parseJsonOutput(fullContent, "volumeArray");

      if (!result || !result.newDesc || !result.reason) {
        throw new Error("校准结果格式不正确");
      }

      generationLogger.completeGeneration(logId);

      if (onMessage) {
        onMessage("大纲校准完成");
      }

      return {
        newDesc: result.newDesc,
        reason: result.reason,
      };
    } catch (error: any) {
      logger.error(
        "OutlineService",
        `校准失败 (尝试 ${retryCount + 1}/${maxRetries + 1})`,
        error
      );

      retryCount++;
      if (retryCount > maxRetries) {
        generationLogger.completeGeneration(logId);
        toast.error("大纲校准失败，请重试");
        return null;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return null;
}
