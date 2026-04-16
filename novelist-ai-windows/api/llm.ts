// api/llm.ts
// 智能路由的 AI 服务代理 - 所有 AI 请求的统一入口点
// 遵循单一职责原则：专注于路由、认证和请求转发

import { GoogleGenerativeAI } from "@google/generative-ai";

// 大纲生成的 JSON 结构定义
const outlineSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "章节唯一标识符，例如 'ch1', 'ch2'",
      },
      title: {
        type: "string",
        description: "章节标题",
      },
    },
    required: ["id", "title"],
  },
};

/**
 * 封装 NewAPI 的 fetch 函数，自动注入认证信息
 * 重构为支持新的结构化设置
 * 遵循单一职责原则，专注于 API 调用封装
 */
async function fetchNewApi(endpoint: string, body: object, settings?: any) {
  // 优先使用前端传递的 apiKey，再回退到环境变量
  const apiKey = settings?.apiKey || process.env.NEW_API_KEY;
  if (!apiKey)
    throw new Error("API Key is not configured in settings or on the server.");

  // 优先使用用户设置的 Base URL，然后回退到服务器环境变量，最后是默认值
  const baseUrl =
    settings?.baseUrl ||
    process.env.NEW_API_BASE_URL ||
    "https://api.openai.com/v1";

  // 健壮性处理：移除末尾可能存在的斜杠，确保路径拼接正确
  const apiUrl = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;

  return fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

export async function POST(req: Request) {
  try {
    // 1. 解析前端请求：获取指令 (action) 和数据 (payload)
    const { action, payload } = await req.json();
    // ✅ 从 payload 中解构出 settings
    const { settings, ...restPayload } = payload;

    // 2. 安全检查：验证 action 是否存在
    if (!action) {
      return new Response(JSON.stringify({ error: "Missing 'action'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. 核心 AI 路由逻辑：根据 action 智能分发
    switch (action) {
      case "testConnection": {
        // 使用 settings 对象中的 baseUrl 和 apiKey 进行测试
        const testResponse = await fetchNewApi(
          "/chat/completions",
          {
            model: "gpt-3.5-turbo", // 使用一个常见且便宜的模型进行测试
            messages: [{ role: "user", content: "Hello!" }],
            max_tokens: 5,
          },
          settings
        );

        if (!testResponse.ok) {
          const errorText = await testResponse.text();
          throw new Error(`Test failed: ${errorText}`);
        }
        return new Response(
          JSON.stringify({ message: "Connection successful!" }),
          { status: 200 }
        );
      }

      // ✅ 唯一保留的核心处理逻辑
      case "chat": {
        const { messages, stream, expectJson } = restPayload;
        
        // 1. 获取 Provider 配置 (Gemini vs OpenAI Compatible)
        const isGemini = settings?.baseUrl?.includes("googleapis") ||
                        (settings?.model && settings.model.includes("gemini"));
        
        // A. Gemini 处理路径
        if (isGemini && process.env.API_KEY) {
           const geminiApiKey = process.env.API_KEY;
           const genAI = new GoogleGenerativeAI(geminiApiKey);
           const modelName = settings?.model || process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
           // ✅ 支持 JSON 模式
           const generationConfig = {
             temperature: settings?.temperature ?? 0.7,
             maxOutputTokens: settings?.maxTokens ?? 4096,
             responseMimeType: expectJson ? "application/json" : "text/plain", // ✅ 支持 JSON 模式
           };

           // 将 messages 转换为 Gemini 格式
           const contents = messages.map((m: any) => ({
             role: m.role === "user" ? "user" : "model",
             parts: [{ text: m.content }]
           }));

           if (stream) {
              const model = genAI.getGenerativeModel({ model: modelName });
              const resultStream = await model.generateContentStream({
                contents,
                generationConfig
              });
              
              // 转换为 SSE 格式流式响应
              const readableStream = new ReadableStream({
                async start(controller) {
                  try {
                    for await (const chunk of resultStream.stream) {
                      const chunkText = chunk.text();
                      if (chunkText) {
                        controller.enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: chunkText } }] })}\n\n`);
                      }
                    }
                    controller.enqueue("data: [DONE]\n\n");
                  } finally {
                    controller.close();
                  }
                },
              });

              return new Response(readableStream, {
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  Connection: "keep-alive",
                },
              });
           } else {
              const model = genAI.getGenerativeModel({ model: modelName });
              const response = await model.generateContent({
                contents,
                generationConfig
              });
              
              const result = response.response.text();
              return new Response(JSON.stringify({ result }), { status: 200 });
           }
        }
        
        // B. OpenAI / NewAPI 处理路径
        else {
           const body: any = {
            model: settings?.model || "gpt-4o-mini",
            messages: messages,
            temperature: settings?.temperature,
            max_tokens: settings?.maxTokens,
            stream: !!stream
          };
          
          // ✅ 支持 JSON 模式 (OpenAI 格式)
          if (expectJson) {
            body.response_format = { type: "json_object" };
          }

          const response = await fetchNewApi("/chat/completions", body, settings);
          
          if (stream) {
            return new Response(response.body, {
              headers: { "Content-Type": "text/event-stream" }
            });
          } else {
            const data = await response.json();
            const result = data.choices[0].message.content;
            return new Response(JSON.stringify({ result }), { status: 200 });
          }
        }
        break; // Switch break
      }

      case "createEmbedding": {
        const embeddingModel =
          settings?.model ||
          process.env.NEW_API_EMBEDDING_MODEL ||
          "text-embedding-3-small";
        const { text } = restPayload;

        // 使用与 fetchNewApi 相同的逻辑来构建 embeddingUrl
        const baseUrl =
          settings?.baseUrl ||
          process.env.NEW_API_BASE_URL ||
          "https://api.openai.com/v1";
        const finalEmbeddingUrl = `${baseUrl.replace(/\/+$/, "")}/embeddings`;

        const response = await fetch(finalEmbeddingUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${
              settings?.apiKey || process.env.NEW_API_KEY
            }`,
          },
          body: JSON.stringify({
            input: text,
            model: embeddingModel,
          }),
        });

        if (!response.ok) {
          throw new Error(`Embedding API error: ${await response.text()}`);
        }

        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding) {
          throw new Error("Embedding not found in API response");
        }

        return new Response(JSON.stringify({ embedding }), { status: 200 });
      }

      // ❌ 移除了 generateOutline, continueWriting, polishText, expandText
      
      default:
        return new Response(JSON.stringify({ error: `Invalid action: ${action}` }), { status: 400 });
    }
  } catch (error) {
    console.error("Fatal error in LLM proxy:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "An internal server error occurred",
      }),
      { status: 500 }
    );
  }
}
