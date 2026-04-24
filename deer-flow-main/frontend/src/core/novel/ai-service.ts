import { globalAiService, type AiRequestOptions, type AiStreamCallbacks } from "@/core/ai/global-ai-service";

export type { AiRequestOptions, AiStreamCallbacks } from "@/core/ai/global-ai-service";

export const NOVEL_AI_MODULE_IDS = {
  chat: "novel-ai-chat",
  outline: "novel-outline",
  chapterAiEdit: "novel-chapter-ai-edit",
} as const;

function withNovelModuleContext(
  options: AiRequestOptions,
  moduleId: string
): AiRequestOptions {
  return {
    ...options,
    moduleId,
    context: {
      ...(options.context ?? {}),
      moduleId,
      module_id: moduleId,
    },
  };
}

class NovelAiServiceAdapter {
  async chat(
    options: AiRequestOptions,
    callbacks?: AiStreamCallbacks
  ): Promise<string> {
    return globalAiService.chat(options, callbacks);
  }

  abort(): void {
    globalAiService.abort();
  }

  async generateOutline(novelContext: Record<string, any>): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content:
                "你是一个专业的小说创作助手，擅长帮助作者构建引人入胜的故事大纲。",
            },
            {
              role: "user",
              content: `请基于以下信息帮助我生成小说大纲：\n${JSON.stringify(novelContext, null, 2)}`,
            },
          ],
        },
        NOVEL_AI_MODULE_IDS.outline
      )
    );
  }

  async continueWriting(
    currentContent: string,
    context: Record<string, any>,
    signal?: AbortSignal,
    novelId?: string
  ): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content: `你是一个小说续写助手。基于以下上下文信息，继续写故事。保持角色性格一致，情节连贯。
上下文：${JSON.stringify(context, null, 2)}`,
            },
            {
              role: "user",
              content: `请继续以下章节的内容：\n${currentContent}`,
            },
          ],
          novelId,
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      ),
      { abortSignal: signal }
    );
  }

  async polishText(text: string, style?: string): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content: `你是一个专业的文字润色助手。${
                style ? `请使用${style}风格。` : ""
              }改进文字表达的流畅度、用词准确性和文学性，但不要改变原文的核心意思。`,
            },
            { role: "user", content: `请润色以下文字：\n${text}` },
          ],
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      )
    );
  }

  async expandScene(
    sceneDescription: string,
    context: Record<string, any>
  ): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content: `你是一个场景扩写助手。基于以下角色和世界观信息，将简短的场景描述扩写成详细的叙述。
上下文：${JSON.stringify(context, null, 2)}`,
            },
            { role: "user", content: `请扩写以下场景：\n${sceneDescription}` },
          ],
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      )
    );
  }

  async condenseText(text: string, signal?: AbortSignal): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content:
                "你是一个文字精简助手。请将以下段落精简压缩，保留核心情节和关键信息，去除冗余描写。不要改变原文的核心意思。",
            },
            { role: "user", content: `请精简以下文字：\n${text}` },
          ],
          stream: true,
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      ),
      { abortSignal: signal }
    );
  }

  async rewriteText(text: string, signal?: AbortSignal): Promise<string> {
    return this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content:
                "你是一个文字改写助手。请用更加生动、引人入胜的方式重写以下段落，保持原意不变但提升文学性和可读性。",
            },
            { role: "user", content: `请重写以下文字：\n${text}` },
          ],
          stream: true,
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      ),
      { abortSignal: signal }
    );
  }

  async extractEntities(text: string): Promise<Record<string, any[]>> {
    const response = await this.chat(
      withNovelModuleContext(
        {
          messages: [
            {
              role: "system",
              content:
                "你是一个实体提取助手。从文本中提取角色、场景、物品、势力等实体信息。请以JSON格式返回，格式：{\"characters\": [], \"settings\": [], \"items\": [], \"factions\": []}",
            },
            { role: "user", content: `从以下文本中提取实体：\n${text}` },
          ],
          stream: false,
        },
        NOVEL_AI_MODULE_IDS.chapterAiEdit
      )
    );

    try {
      return JSON.parse(response);
    } catch {
      return { characters: [], settings: [], items: [], factions: [] };
    }
  }
}

export const novelAiService = new NovelAiServiceAdapter();
