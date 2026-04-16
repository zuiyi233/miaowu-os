import { useStyleStore } from "../stores/useStyleStore";
import { WRITING_STYLES } from "../src/lib/prompts/styles/presets";
import {
  NOVEL_GENRES,
  NOVEL_TAGS,
  WORD_COUNTS,
} from "../src/lib/constants/novel-options";
import { NovelMetadata } from "../types";

export const styleInjectionService = {
  /**
   * 根据小说元数据构建系统级文风指令
   */
  buildStyleSystemInstruction(metadata?: NovelMetadata): string {
    if (!metadata) return "";

    const parts: string[] = [];

    // 1. 核心文风 (Style) - 基调与人设
    // 优先从 Store 获取，以支持用户自定义/修改过的文风
    if (metadata.styleId) {
      const allStyles = useStyleStore.getState().styles; // 获取所有样式（含自定义）
      let style = allStyles.find((s) => s.id === metadata.styleId);

      // 回退方案：如果 Store 中找不到（比如是在其他设备创建的），尝试从静态列表找
      if (!style) {
        style = WRITING_STYLES.find((s) => s.id === metadata.styleId);
      }

      if (style) {
        parts.push(`【核心文风协议 (System)】：\n${style.systemPrompt}`);
      }
    }

    // 2. 篇幅与节奏 (Word Count / Pacing) - 这决定了 AI 写作的详略程度和剧情密度
    if (metadata.wordCountId) {
      const lengthOption = WORD_COUNTS.find(
        (w) => w.id === metadata.wordCountId
      );
      if (lengthOption) {
        parts.push(`【篇幅与节奏控制】：\n${lengthOption.promptContext}`);
      }
    }

    // 3. 题材设定 (Genres) - 世界观物理法则
    if (metadata.genreIds && metadata.genreIds.length > 0) {
      const genres = NOVEL_GENRES.filter((g) =>
        metadata.genreIds?.includes(g.id)
      );
      if (genres.length > 0) {
        const genrePrompts = genres
          .map((g) => `- [${g.label}]: ${g.promptContext}`)
          .join("\n");
        parts.push(`【题材设定要求】：\n${genrePrompts}`);
      }
    }

    // 4. 关键元素 (Tags) - 爽点与桥段
    if (metadata.tagIds && metadata.tagIds.length > 0) {
      const tags = NOVEL_TAGS.filter((t) => metadata.tagIds?.includes(t.id));
      if (tags.length > 0) {
        const tagPrompts = tags
          .map((t) => `- [${t.label}]: ${t.promptContext}`)
          .join("\n");
        parts.push(`【关键元素/爽点】：\n${tagPrompts}`);
      }
    }

    // 5. 专属设定 (Custom) - 用户特供
    if (metadata.customPrompt) {
      parts.push(
        `【作者原本的大纲构思】：\n${metadata.customPrompt}\n(请在正文写作中延续上述构思的风格和逻辑)`
      );
    }

    if (parts.length === 0) return "";

    return `
=== 🛑 必须严格遵守的创作法则 (Style Protocol) 🛑 ===
以下配置源自作者在【大纲规划阶段】的定调。
在正文写作时，必须**无条件继承**这些设定，确保从大纲到正文的风格一致性。

${parts.join("\n\n")}
=====================================================
`;
  },
};
