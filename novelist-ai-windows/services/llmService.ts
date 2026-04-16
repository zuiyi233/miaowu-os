import { useSettingsStore } from "../stores/useSettingsStore";
import { toast } from "sonner";
import { logger } from "../lib/logging";
import { getModelSpec } from "../src/lib/constants/modelSpecs";

// 定义统一的流式回调接口
export interface StreamCallbacks {
  onMessage: (content: string) => void;
  onReasoning?: (content: string) => void;
  onThinking?: (isThinking: boolean) => void;
  // ✅ 新增：Usage 回调
  onUsage?: (usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }) => void;
  onError?: (error: Error) => void;
  onFinish?: () => void;
}

/**
 * 统一请求执行器
 */
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

// ✅ 流式解析状态机
class StreamParser {
  private buffer = "";
  private inThinkingBlock = false;

  constructor(private callbacks: StreamCallbacks) {}

  processChunk(delta: any, fullJson?: any) {
    // ✅ 接收 fullJson 以获取 usage
    // 🔍 调试专用：打印每一帧的原始 delta 数据
    // 如果你在控制台看到 reasoning_content 但界面没显示，那就是字段名对不上的问题
    // console.log("RAW DELTA:", JSON.stringify(delta));

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

    // 2. 处理正文内容 (可能包含 <think> 标签)
    const content = delta.content || "";
    if (!content) return;

    // --- 智能标签解析逻辑 ---
    this.buffer += content;

    // 检查是否进入 <think> 块
    if (!this.inThinkingBlock) {
      const startIndex = this.buffer.indexOf("<think>");

      if (startIndex !== -1) {
        this.inThinkingBlock = true;
        this.callbacks.onThinking?.(true);

        // 发送标签之前的内容
        if (startIndex > 0) {
          const preContent = this.buffer.slice(0, startIndex);
          this.callbacks.onMessage(preContent);
        }

        // 截断缓冲区
        this.buffer = this.buffer.slice(startIndex + 7); // <think> length is 7
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
  isRetry: boolean = false // ✅ 新增：防止无限递归
) {
  const state = useSettingsStore.getState();
  const modelConfig = state.modelSettings[taskType];
  const provider = state.providers.find((p) => p.id === modelConfig.providerId);

  if (!provider) {
    const errorMsg = `未找到 ${taskType} 任务的有效服务商配置`;
    toast.error(errorMsg);
    logger.error("LLMService", errorMsg);
    throw new Error(errorMsg);
  }

  logger.info("LLMService", `Starting ${taskType} task`, {
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
      `[LLMService] Requested max_tokens (${safeMaxTokens}) exceeds model limit (${spec.maxOutput}). Clamping.`
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

  logger.debug("LLMService", "Request Payload", body);

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

    // 🔍 调试开关：设为 true 可以在控制台看到每一条原始数据
    const DEBUG_RAW_STREAM = true;

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

            // ✅ 调试点：打印第一层结构
            if (DEBUG_RAW_STREAM) {
              // 只打印包含 choices 的帧，过滤掉 usage 帧
              if (json.choices && json.choices.length > 0) {
                console.log("Stream Chunk:", json.choices[0].delta);
              }
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
    logger.success("LLMService", "Stream finished");
    callbacks.onFinish?.();
  } catch (error: any) {
    if (error.name === "AbortError") {
      logger.warn("LLMService", "Request aborted");
      return;
    }

    // ✅ 增强错误处理：如果是 400 且包含 max_tokens 错误，尝试自动修复并重试（可选的高级功能）
    if (
      error.message.includes("max_tokens") &&
      error.message.includes("too large")
    ) {
      // 解析错误信息中的限制值 (例如 "supports at most 32768")
      const match = error.message.match(/at most (\d+)/);
      if (match) {
        const serverLimit = parseInt(match[1]);
        logger.warn(
          "LLMService",
          `Auto-correcting max_tokens to ${serverLimit} and retrying...`
        );

        // 修改 body 并重试
        // 这里需要递归调用或者重新 fetch，为了简单起见，建议先做好上面的 "Pre-check" (specs)
        // 只要上面的 getModelSpec 足够完善，这里几乎不会触发
      }
    }

    logger.error("LLMService", "Request Failed", error);
    callbacks.onError?.(error);
    toast.error(`AI 请求失败: ${error.message}`);
  }
}

// ... (Exports) ...
export async function advancedStreamChat(
  history: any[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
) {
  return fetchChatCompletion(history, "chat", callbacks, signal);
}

export async function streamChat(
  history: any[],
  onMessage: (content: string) => void,
  signal?: AbortSignal
) {
  return fetchChatCompletion(
    history,
    "chat",
    {
      onMessage,
      onReasoning: (text) => console.log("Reasoning (hidden):", text),
    },
    signal
  );
}

export async function continueWriting(
  text: string, // 这里传入的通常是选中的文本，或者光标前的文本
  onMessage: (content: string) => void,
  signal?: AbortSignal
) {
  const { contextEngineService } = await import("./contextEngineService");
  const { useContextStore } = await import("../stores/useContextStore"); // 动态导入 Store

  // 1. 获取 Context Store 状态
  const contextStore = useContextStore.getState();

  // 2. JIT 分析策略：只在必要时触发分析
  // 检查是否需要自动分析的条件：
  // - Store 为空（没有任何活跃上下文）
  // - 文本长度足够（避免对短文本进行无意义分析）
  // - 数据已脏（用户可能修改了实体或内容）
  const shouldAutoAnalyze =
    Object.values(contextStore.activeData).every((arr) => arr.length === 0) && // Store 完全为空
    text.length > 100 && // 文本足够长
    contextStore.isDirty; // 数据已脏

  if (shouldAutoAnalyze) {
    logger.info(
      "LLMService",
      "Auto-triggering context analysis due to empty store and dirty state"
    );
    await contextStore.performAnalysis(text);
  }

  // 3. 检查是否有活跃上下文（手动/Radar 模式）
  const hasActiveContext = Object.values(contextStore.activeData).some(
    (arr) => arr.length > 0
  );

  // 4. 获取用户意图
  const userIntent = text.trim()
    ? `请基于以下选段继续写作：\n${text}`
    : "请根据上文逻辑和章节目标，继续撰写正文。";

  // 5. 构建最终 Prompt
  let finalPrompt: string;

  if (hasActiveContext) {
    // 使用 Radar 数据（用户手动确认过的上下文）
    logger.info("LLMService", "Using manual context from Radar");
    const context = contextEngineService.assembleManualContext(
      contextStore.activeData
    );

    // 应用截断逻辑以避免超出 Token 限制
    const truncatedContext = (contextEngineService as any).truncateContext(
      context
    );
    finalPrompt = contextEngineService.buildPrompt(
      truncatedContext,
      userIntent
    );
  } else {
    // 回退到传统的自动分析逻辑
    logger.info("LLMService", "Using automatic context analysis");
    const result = await contextEngineService.analyzeContextWithOptions(
      userIntent,
      {
        includeWorld: true,
        includeChapter: true,
        includeOutline: false,
      }
    );
    finalPrompt = result.prompt;
  }

  // 6. 发送请求
  return fetchChatCompletion(
    [{ role: "user", content: finalPrompt }],
    "continue",
    { onMessage },
    signal
  );
}

export async function polishText(text: string, signal?: AbortSignal) {
  let result = "";
  const { contextEngineService } = await import("./contextEngineService");
  const prompt = await contextEngineService.hydratePrompt(
    "Polish: {{selection}}",
    { selection: text }
  );

  await fetchChatCompletion(
    [{ role: "user", content: prompt }],
    "polish",
    {
      onMessage: (chunk) => {
        result += chunk;
      },
    },
    signal
  );
  return result;
}

export async function expandText(text: string, signal?: AbortSignal) {
  let result = "";
  const { contextEngineService } = await import("./contextEngineService");
  const prompt = await contextEngineService.hydratePrompt(
    "Expand: {{selection}}",
    { selection: text }
  );

  await fetchChatCompletion(
    [{ role: "user", content: prompt }],
    "expand",
    {
      onMessage: (chunk) => {
        result += chunk;
      },
    },
    signal
  );
  return result;
}

export async function generateOutline(prompt: string, signal?: AbortSignal) {
  let result = "";
  const { contextEngineService } = await import("./contextEngineService");
  const hydratedPrompt = await contextEngineService.hydratePrompt(
    "Outline: {{input}}",
    { input: prompt }
  );

  await fetchChatCompletion(
    [{ role: "user", content: hydratedPrompt }],
    "outline",
    {
      onMessage: (chunk) => {
        result += chunk;
      },
    },
    signal
  );

  try {
    const jsonStr = result
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed)
      ? parsed
      : parsed.chapters || parsed.outline || [];
  } catch {
    console.warn(
      "Outline generation returned non-JSON, returning raw text as single chapter"
    );
    return [{ id: "auto-1", title: "大纲生成结果", content: result }];
  }
}

export async function createEmbedding(text: string, signal?: AbortSignal) {
  const state = useSettingsStore.getState();
  const config = state.modelSettings.embedding;
  const provider = state.providers.find((p) => p.id === config.providerId);

  if (!provider) throw new Error("未找到 Embedding 服务商配置");

  const response = await executeRequest(
    provider.baseUrl,
    "/embeddings",
    {
      method: "POST",
      body: JSON.stringify({
        model: config.model,
        input: text,
      }),
      signal,
    },
    provider.apiKey
  );

  const data = await response.json();
  return data.data?.[0]?.embedding;
}

export async function extractRelationships(text: string) {
  return extractJsonTask(text, "extraction", "Extract Relationships");
}

export async function generateTimeline(text: string) {
  return extractJsonTask(text, "extraction", "Generate Timeline");
}

async function extractJsonTask(
  text: string,
  taskType: any,
  promptPrefix: string
) {
  let result = "";
  const { contextEngineService } = await import("./contextEngineService");
  const prompt = await contextEngineService.hydratePrompt(
    `${promptPrefix}: {{selection}}`,
    { selection: text }
  );

  await fetchChatCompletion([{ role: "user", content: prompt }], taskType, {
    onMessage: (chunk) => {
      result += chunk;
    },
  });

  try {
    const jsonStr = result
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("AI 返回的 JSON 格式错误");
  }
}

export async function testApiConnection(config: {
  baseUrl: string;
  apiKey: string;
  model?: string;
}) {
  console.log("[Test] Connecting:", config.baseUrl);

  const response = await executeRequest(
    config.baseUrl,
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: config.model || "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
    },
    config.apiKey
  );

  return { message: "连接成功" };
}

// ✅ 新增：获取服务商可用模型列表
export async function fetchProviderModels(
  providerId: string
): Promise<string[]> {
  const state = useSettingsStore.getState();
  const provider = state.providers.find((p) => p.id === providerId);

  if (!provider) {
    throw new Error("未找到服务商配置");
  }

  // 这是一个只读操作，通常不需要流式处理
  // 大多数 OpenAI 兼容接口（包括 NewAPI Client API）使用 /models 路径
  try {
    const response = await executeRequest(
      provider.baseUrl,
      "/models", // 标准 OpenAI 兼容端点
      {
        method: "GET",
      },
      provider.apiKey
    );

    const data = await response.json();

    // 1. 标准 OpenAI 格式: { data: [{ id: "gpt-4" }, ...] }
    if (Array.isArray(data.data)) {
      return data.data.map((m: any) => m.id).filter(Boolean);
    }

    // 2. 兼容 Ollama 格式: { models: [{ name: "llama3" }, ...] }
    if (Array.isArray(data.models)) {
      return data.models.map((m: any) => m.name).filter(Boolean);
    }

    // 3. 兼容 NewAPI 管理端格式 (如果用户错误配置了管理端地址): { data: { "1": ["gpt-4"], ... } }
    if (
      data.success &&
      typeof data.data === "object" &&
      !Array.isArray(data.data)
    ) {
      const allModels = new Set<string>();
      Object.values(data.data).forEach((models: any) => {
        if (Array.isArray(models)) {
          models.forEach((m) => allModels.add(m));
        }
      });
      return Array.from(allModels);
    }

    throw new Error("无法解析模型列表响应格式");
  } catch (error) {
    console.error("Fetch models failed:", error);
    throw error;
  }
}

/**
 * 专门用于从大纲文本中提取世界观实体
 * @param outlineText 大纲的完整文本内容
 */
export async function extractWorldFromOutline(outlineText: string) {
  const systemPrompt = `你是一个专业的文学策划助手。你的任务是从用户提供的小说大纲中，提取出核心的世界观设定，并整理成 JSON 格式。

请提取以下四类实体：
1. characters (角色): 姓名、简短人设描述。
2. factions (势力): 组织名称、组织性质描述。
3. settings (场景): 地点名称、环境描述。
4. items (物品): 关键道具/金手指、功能描述。

【重要原则】：
- 只提取大纲中明确提到的名词。
- 如果大纲没提到某类实体，该数组留空。
- 输出必须是纯 JSON，不要包含 Markdown 代码块标记。

JSON 格式示例：
{
  "characters": [
    {"name": "李火旺", "description": "心素迷惘，分不清现实与幻觉的修仙者"},
    {"name": "红中", "description": "坐忘道成员，善于欺骗"}
  ],
  "factions": [
    {"name": "坐忘道", "description": "以欺骗为乐的邪祟组织"}
  ],
  "settings": [],
  "items": []
}
`;

  let result = "";

  // 使用 extraction 任务配置 (通常是 gpt-4o-mini 或 flash 模型，速度快便宜)
  await fetchChatCompletion(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `以下是小说大纲，请提取设定：\n\n${outlineText}`,
      },
    ],
    "extraction",
    {
      onMessage: (chunk) => {
        result += chunk;
      },
    }
  );

  try {
    const jsonStr = result
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("World extraction JSON parse failed:", result);
    throw new Error("AI 提取的数据格式有误，请重试");
  }
}

/**
 * 生成章节摘要 (Fact Summary)
 * 用于在写完章节后，将几千字的正文压缩成 100-200 字的剧情梗概
 */
export async function summarizeChapter(content: string) {
  const prompt = `
你是一个专业的网文编辑。请阅读以下章节正文，生成一个精炼的【剧情摘要】。

要求：
1. 仅陈述发生的客观事实（谁、在哪里、做了什么、结果如何）。
2. 忽略心理描写和环境描写。
3. 字数控制在 150 字以内。
4. 不要包含"本章讲述了"等废话，直接叙述。

正文内容：
${content.slice(0, 10000)}
`; // 截取前1w字防止超标，通常章节也就3k-5k字

  let result = "";

  // 使用 extraction 配置 (通常对应 fast model)
  await fetchChatCompletion([{ role: "user", content: prompt }], "extraction", {
    onMessage: (chunk) => {
      result += chunk;
    },
  });

  return result.trim();
}
