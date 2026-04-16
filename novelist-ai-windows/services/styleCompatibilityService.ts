import { WRITING_STYLES, StyleTone } from "../src/lib/prompts/styles/presets";
import {
  getGenreCategory,
  GenreCategory,
} from "../src/lib/constants/novel-options";

// ==========================================
// 类型定义
// ==========================================

export interface CompatibilityResult {
  score: number; // 0-100
  level: "perfect" | "good" | "neutral" | "risky" | "conflict";
  issues: string[]; // 负面提示
  suggestions: string[]; // 正面反馈
  isCompatible: boolean; // score >= 40
}

interface InternalConstraint {
  name: string;
  conflictCondition: (genres: string[], tags: string[]) => boolean;
  exceptionStyles: string[];
  message: string;
  penalty: number;
}

interface SynergyRule {
  name: string;
  condition: (genres: string[], tags: string[]) => boolean;
  message: string;
  bonus: number;
}

// ==========================================
// 1. 静态配置矩阵
// ==========================================

const INCOMPATIBLE_CATEGORIES: Record<GenreCategory, GenreCategory[]> = {
  fantasy: ["urban"],
  urban: ["fantasy"],
  mechanic: [],
  emotional: [],
  other: [],
};

const BRIDGE_RULES: Record<string, string[]> = {
  "fantasy:urban": [
    "mode_spiritual_recovery",
    "urban_super",
    "modern_cultivation",
    "mode_urban_legend",
    "cheat_cheat_system",
    "gate_invades",
    "mode_national",
  ],
  "urban:fantasy": [
    "time_travel",
    "history_reform",
    "cheat_cheat_system",
    "mode_stream",
  ],
  "fantasy:scifi": [
    "cyber_cultivation",
    "infinite",
    "mecha",
    "cheat_black_tech",
    "stellar",
  ],
  "history:scifi": ["industrial_revolution", "time_travel", "cheat_black_tech"],
};

const TONE_CLASH_MAP: Record<StyleTone, string[]> = {
  serious: [
    "abstract_fun",
    "daily_romcom",
    "comedy_gag",
    "system_parody",
    "char_social_terrorist",
    "mode_abstract", // ✅ 修正: 脑洞标签
  ],
  dark: [
    "sweet_pet",
    "daily_romcom",
    "campus_youth",
    "pet_cafe",
    "farming_rural",
    "rel_sweet_pet",
  ],
  humorous: [
    "mode_dark_forest", // ✅ 修正 ID: dark_forest -> mode_dark_forest
    "rules_horror",
    "mode_be_aesthetic", // ✅ 修正 ID: tragedy -> mode_be_aesthetic
    "aesthetic_grimdark",
  ],
  light: [
    "horror_rules",
    "mode_dark_forest", // ✅ 修正 ID
    "cthulhu_steampunk",
    "aesthetic_grimdark",
    "mode_mental_illness",
  ],
  neutral: [],
};

// ==========================================
// 2. 深度逻辑规则 (已修复所有幽灵ID)
// ==========================================

const INTERNAL_CONSTRAINTS: InternalConstraint[] = [
  {
    name: "Harem vs Pure Love",
    conflictCondition: (g, t) =>
      (t.includes("rel_harem") || t.includes("rel_polyamory_harmony")) &&
      (t.includes("rel_1v1_loyal") ||
        t.includes("rel_no_cp") ||
        // ✅ 修正: 检查具体的纯爱流派 ID，而不是不存在的 "pure_love" ID
        g.some((id) =>
          [
            "xianxia_bl",
            "modern_bl",
            "infinite_bl",
            "campus_bl",
            "historical_bl",
            "guide_sentinel",
          ].includes(id)
        )),
    exceptionStyles: ["style_brainhole"],
    message: "【后宫/多女主】与【纯爱/无CP】标签逻辑互斥，请二选一。",
    penalty: 25,
  },
  {
    name: "Big Heroine vs Male Tropes",
    conflictCondition: (g, t) =>
      (g.includes("big_heroine") || t.includes("char_sober")) &&
      (t.includes("rel_harem") ||
        g.includes("urban_short_drama") ||
        t.includes("mode_regret_male")),
    exceptionStyles: [],
    message: "【大女主】题材通常排斥【后宫/赘婿】等传统男频套路。",
    penalty: 20,
  },
  {
    name: "Realism vs High Magic",
    conflictCondition: (g, t) =>
      g.some((id) =>
        // ✅ 修正: urban_life -> 具体的生活流/职业流 ID
        [
          "medical",
          "lawyer",
          "farming_rural",
          "handicraft",
          "pet_cafe",
          "teacher",
        ].includes(id)
      ) &&
      t.some((id) =>
        [
          "cultivation_sword",
          "magic_western",
          "mode_sect_building",
          "cheat_immortality",
        ].includes(id)
      ) &&
      !t.some((id) =>
        [
          "urban_super",
          "mode_spiritual_recovery",
          "cheat_cheat_system",
          "mode_abstract", // ✅ 修正: mode_brainhole -> mode_abstract
          "mode_brainhole", // 兼容新加的标签
        ].includes(id)
      ),
    exceptionStyles: [
      "style_brainhole",
      "style_infinite",
      "style_game",
      "style_system",
    ],
    message:
      "现实主义题材出现高魔元素，建议添加【灵气复苏】或【系统】作为逻辑支撑。",
    penalty: 15,
  },
  {
    name: "Ancient vs Cyber",
    conflictCondition: (g, t) =>
      g.some((id) =>
        [
          "historical_fiction", // ✅ 修正: history_realism -> historical_fiction
          "history_reform",
          "court_intrigue",
          "wuxia_traditional",
          "three_kingdoms",
        ].includes(id)
      ) &&
      t.some((id) =>
        [
          "mode_stream", // ✅ 修正: mode_livestream -> mode_stream
          "mode_chatroom",
          "cyber_prosthetics",
          "aesthetic_steampunk",
        ].includes(id)
      ) &&
      !t.some((id) =>
        [
          "time_travel",
          "cheat_cheat_system",
          "industrial_revolution",
          "cyber_cultivation",
        ].includes(id)
      ),
    exceptionStyles: ["style_brainhole", "style_system", "style_acg"],
    message:
      "古代背景出现现代/赛博元素，建议确认是否为【穿越/系统】或【赛博修仙】设定。",
    penalty: 15,
  },
];

const SYNERGY_RULES: SynergyRule[] = [
  {
    name: "Dihua Combo",
    condition: (g, t) =>
      t.includes("mode_dihua") &&
      (t.includes("char_steady") ||
        t.includes("char_mask") ||
        t.includes("mode_imposter")),
    message:
      "💡 绝妙搭配：【迪化流】+【稳健/马甲/冒充】是制造反差爽感的经典组合。",
    bonus: 10,
  },
  {
    name: "Lying Flat Invincible",
    condition: (g, t) =>
      (t.includes("char_lying_flat") || t.includes("char_salted_fish")) &&
      (t.includes("cheat_sign_in") ||
        t.includes("cheat_hook_afk") ||
        t.includes("mode_invincible_start")),
    message:
      "💡 舒适区：【摆烂/咸鱼】人设配合【签到/挂机】系统，爽感浑然天成。",
    bonus: 10,
  },
  {
    name: "Cyber Cultivation",
    condition: (g, t) =>
      (g.includes("cyberpunk") || t.includes("aesthetic_steampunk")) &&
      (g.includes("xianxia") ||
        t.includes("cultivation_body") ||
        t.includes("cultivation_sword")),
    message:
      "💡 潮流前线：【赛博朋克】+【修仙】是当下的热门跨界流派，极具张力。",
    bonus: 15,
  },
  {
    name: "Streamer Shock",
    condition: (g, t) =>
      t.includes("mode_stream") &&
      (g.includes("horror_rules") ||
        g.includes("wilderness_survival") ||
        g.includes("metaphysics_stream")),
    message:
      "💡 流量密码：【直播】+【恐怖/求生/玄学】能最大化利用观众弹幕制造爽点。",
    bonus: 10,
  },
  {
    name: "Short Drama Rhythm",
    condition: (g, t) =>
      t.includes("mode_fast_paced") &&
      (t.includes("mode_kill_quick") ||
        t.includes("char_decisive") ||
        t.includes("mode_face_slap") || // ✅ 修正: 确保此标签在 tags.ts 中已添加
        g.includes("urban_short_drama")),
    message:
      "💡 爆款公式：【快节奏/短剧风】+【打脸/杀伐果断】非常符合当前市场快餐化阅读需求。",
    bonus: 10,
  },
];

// ==========================================
// 3. 服务逻辑
// ==========================================

export const styleCompatibilityService = {
  checkCompatibility(
    styleId: string,
    selectedGenreIds: string[],
    selectedTagIds: string[]
  ): CompatibilityResult {
    const style = WRITING_STYLES.find((s) => s.id === styleId);

    if (!style) return this.createResult(60, [], []);
    if (selectedGenreIds.length === 0)
      return this.createResult(60, [], ["请选择至少一个题材以评估契合度"]);

    const {
      recommendedGenres,
      recommendedTags,
      conflictGenres = [],
      conflictTags = [],
      category: styleCategory,
      tone: styleTone,
    } = style.metadata;

    let score = 70;
    const issues: string[] = [];
    const suggestions: string[] = [];
    const allSelectedIds = [...selectedGenreIds, ...selectedTagIds];

    // 1. 内部逻辑检查
    for (const constraint of INTERNAL_CONSTRAINTS) {
      if (constraint.conflictCondition(selectedGenreIds, selectedTagIds)) {
        if (!constraint.exceptionStyles.includes(styleId)) {
          score -= constraint.penalty;
          issues.push(constraint.message);
        } else {
          suggestions.push(
            `检测到逻辑冲突，但文风【${style.name}】自带豁免权，可忽略。`
          );
        }
      }
    }

    // 2. 文风直接冲突
    const hitConflictGenres = selectedGenreIds.filter((g) =>
      conflictGenres.includes(g)
    );
    if (hitConflictGenres.length > 0) {
      score -= 25 * hitConflictGenres.length;
      issues.push(
        `文风【${style.name}】极难驾驭题材：${hitConflictGenres.join(", ")}`
      );
    }

    const hitConflictTags = selectedTagIds.filter((t) =>
      conflictTags.includes(t)
    );
    if (hitConflictTags.length > 0) {
      score -= 15 * hitConflictTags.length;
      issues.push(
        `文风【${style.name}】与标签冲突：${hitConflictTags.join(", ")}`
      );
    }

    // 3. 基调冲突 (脑洞风豁免)
    if (styleId !== "style_brainhole") {
      const toneClashes = TONE_CLASH_MAP[styleTone] || [];
      const genreClashes = selectedGenreIds.filter((g) =>
        toneClashes.includes(g)
      );
      const tagClashes = selectedTagIds.filter((t) => toneClashes.includes(t));

      if (genreClashes.length > 0 || tagClashes.length > 0) {
        score -= 20;
        issues.push(
          `文风基调(${styleTone})与选定的【${[
            ...genreClashes,
            ...tagClashes,
          ].join("/")}】氛围不符。`
        );
      }
    }

    // 4. 大类逻辑与桥接
    const genreCategories = new Set(
      selectedGenreIds.map((g) => getGenreCategory(g))
    );

    genreCategories.forEach((gCat) => {
      if (
        gCat === styleCategory ||
        gCat === "mechanic" ||
        gCat === "emotional" ||
        styleCategory === "mechanic"
      ) {
        return;
      }

      const incompatibleList = INCOMPATIBLE_CATEGORIES[styleCategory] || [];
      if (incompatibleList.includes(gCat)) {
        const bridgeKey1 = `${styleCategory}:${gCat}`;
        const bridgeKey2 = `${gCat}:${styleCategory}`;
        const bridgeTags = [
          ...(BRIDGE_RULES[bridgeKey1] || []),
          ...(BRIDGE_RULES[bridgeKey2] || []),
        ];

        const hasBridge = allSelectedIds.some((id) => bridgeTags.includes(id));

        if (hasBridge) {
          score += 5;
          suggestions.push(
            `检测到跨流派混搭（${styleCategory} + ${gCat}），桥接元素已生效。`
          );
        } else {
          score -= 20;
          issues.push(
            `尝试用【${style.name}】写【${gCat}】类题材，建议添加'穿越'、'系统'或'灵气复苏'等标签进行逻辑桥接。`
          );
        }
      }
    });

    // 5. 推荐命中
    let matchedRecCount = 0;
    selectedGenreIds.forEach((id) => {
      if (recommendedGenres.includes(id)) matchedRecCount++;
    });
    selectedTagIds.forEach((id) => {
      if (recommendedTags.includes(id)) matchedRecCount++;
    });

    if (matchedRecCount > 0) {
      score += Math.min(matchedRecCount * 5, 20);
    }

    // 6. 黄金搭档
    for (const rule of SYNERGY_RULES) {
      if (rule.condition(selectedGenreIds, selectedTagIds)) {
        score += rule.bonus;
        suggestions.push(rule.message);
      }
    }

    // 7. 最终修正
    if (issues.length >= 2) {
      score = Math.min(score, 55);
    } else if (issues.length === 0 && score >= 80) {
      score += 5;
      suggestions.push("配置堪称完美，AI 将极易发挥。");
    }

    score = Math.min(Math.max(score, 0), 100);

    return this.createResult(score, issues, suggestions);
  },

  createResult(
    score: number,
    issues: string[],
    suggestions: string[]
  ): CompatibilityResult {
    let level: CompatibilityResult["level"] = "neutral";
    if (score >= 90) level = "perfect";
    else if (score >= 75) level = "good";
    else if (score >= 60) level = "neutral";
    else if (score >= 40) level = "risky";
    else level = "conflict";

    return {
      score,
      level,
      issues: [...new Set(issues)],
      suggestions: [...new Set(suggestions)],
      isCompatible: score >= 40,
    };
  },
};
