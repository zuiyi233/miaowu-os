import React, { useState, useMemo } from "react";
import {
  NOVEL_GENRES,
  GENRE_GROUPS,
  NOVEL_TAGS,
  WORD_COUNTS,
  NovelOption,
} from "../../src/lib/constants/novel-options";
import { useStyleStore } from "../../stores/useStyleStore"; // ✅ 引入 StyleStore
import { StyleConfigPanel } from "./StyleConfigPanel"; // ✅ 引入新组件
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "sonner";
import {
  Sparkles,
  Download,
  Loader2,
  Search,
  Wand,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertOctagon,
} from "lucide-react";
// ✅ 引入兼容性服务
import { styleCompatibilityService } from "../../services/styleCompatibilityService";

// ==========================================
// 🧠 全量智能映射表 (Smart Recommendation Map)
// ==========================================
// 逻辑：当左侧选择了 [Key: Genre] 时，右侧自动推荐 [Value: Tags]
const GENRE_TO_TAGS_MAP: Record<string, string[]> = {
  // --- 1. 东方玄幻/仙侠 (Fantasy East) ---
  family_cultivation: [
    "mode_family_rise",
    "cheat_investment",
    "mode_sect_building",
    "mode_farming_war",
  ], // 家族修仙
  simulation_xianxia: [
    "cheat_simulator",
    "cheat_future_diary",
    "cheat_save_load",
    "cheat_insight",
  ], // 模拟推演
  disciple_rebate: [
    "cheat_cashback",
    "mode_teacher",
    "mode_disciple_training",
    "mode_sect_building",
  ], // 授徒返还
  xianxia: [
    "cultivation_sword",
    "cheat_sign_in",
    "char_steady",
    "mode_imposter",
  ], // 古典仙侠
  huanxuan: [
    "char_decisive",
    "mode_fast_paced",
    "mode_auction",
    "mode_tournament",
  ], // 热血玄幻
  honghuang: [
    "cheat_creation",
    "mode_prehistoric",
    "mode_behind_scenes",
    "cheat_merit",
  ], // 洪荒
  wuxia: [
    "char_decisive",
    "rel_brotherhood",
    "mode_tournament",
    "cultivation_body",
  ], // 武侠
  pure_sword: [
    "cultivation_sword",
    "char_decisive",
    "char_cool",
    "char_workaholic",
  ], // 剑修
  summon_army: [
    "cheat_clone_army",
    "mode_fourth_scourge",
    "mode_farming_war",
    "char_zerg",
  ], // 召唤流
  heavenly_secret: [
    "cheat_future_diary",
    "mode_dihua",
    "cheat_insight",
    "mode_behind_scenes",
  ], // 天机算命
  luck_plunder: [
    "char_villain",
    "cheat_plunder",
    "mode_identity_reveal",
    "mode_regret_male",
  ], // 气运掠夺

  // --- 2. 都市与职场 (Urban) ---
  urban_short_drama: [
    "mode_fast_paced",
    "mode_divorce_bet",
    "char_decisive",
    "mode_identity_reveal",
    "mode_face_slap",
  ], // 短剧战神
  rich_villain: [
    "char_villain",
    "cheat_money",
    "mode_regret_male",
    "rel_shuraba",
  ], // 反派富二代
  urban_super: ["mode_spiritual_recovery", "char_mask", "mode_imposter"], // 都市异能
  entertainment: [
    "mode_entertainment_circle",
    "mode_culture_copy",
    "mode_stream",
    "rel_fan_circle",
  ], // 娱乐明星
  retro_business: ["cheat_retro", "cheat_knowledge", "mode_farming_war"], // 年代倒爷
  heavy_industry: ["cheat_black_tech", "mode_scholar", "mode_national"], // 大国重工
  heir_return: ["cheat_money", "mode_identity_reveal", "mode_face_slap"], // 首富归来

  // --- 3. 脑洞与系统 (Brainhole & System) ---
  abstract_fun: [
    "mode_abstract",
    "char_mental",
    "system_parody",
    "char_social_terrorist",
  ], // 抽象乐子人
  rules_horror: [
    "mode_rules",
    "char_mental",
    "mode_escape",
    "mode_urban_legend",
  ], // 规则怪谈
  simplification_system: [
    "cheat_simplification",
    "char_salted_fish",
    "char_lying_flat",
  ], // 简化系统
  emotion_points: [
    "cheat_emotion_points",
    "char_social_terrorist",
    "mode_stream",
    "system_parody",
  ], // 情绪系统
  cashback_system: ["cheat_cashback", "mode_teacher", "rel_sugar_daddy"], // 返还系统
  chat_group_admin: [
    "cheat_chat_group",
    "mode_invitation",
    "mode_behind_scenes",
  ], // 聊天群
  heavens_projection: ["mode_comparison_live", "mode_exposure", "mode_stream"], // 诸天投影
  pawnshop_owner: [
    "cheat_exchange_shop",
    "cheat_soul_trade",
    "mode_behind_scenes",
  ], // 典当铺

  // --- 4. 女频与情感 (Romance) ---
  stepmother_cubs: [
    "mode_stepmother",
    "mode_comparison_live",
    "rel_raising_wife",
    "mode_variety_show",
  ], // 后妈养崽
  guide_sentinel: ["rel_guide_sentinel", "rel_salvation", "rel_soul_mate"], // 哨兵向导
  period_70s: [
    "cheat_portable_space",
    "mode_farming_war",
    "rel_forced_marriage",
    "cheat_retro",
  ], // 年代文
  hoarding_survival: [
    "cheat_portable_space",
    "aesthetic_wasteland",
    "char_steady",
    "mode_farming_war",
  ], // 囤货求生
  big_heroine: ["char_sober", "rel_no_cp", "mode_sect_building"], // 大女主
  palace_struggle: [
    "mode_court_intrigue",
    "char_black_belly",
    "rel_harem_fight",
  ], // 宫斗

  // --- 5. 科幻与游戏 (SciFi & Game) ---
  cyber_cultivation: [
    "aesthetic_steampunk",
    "cheat_bio_edit",
    "cultivation_body",
    "mode_cyber_cultivation",
  ], // 赛博修仙
  swarm_disaster: [
    "char_zerg",
    "cheat_devour",
    "mode_fourth_scourge",
    "cheat_clone_army",
  ], // 虫族天灾
  scp_foundation: [
    "mode_scp",
    "mode_acting_method",
    "char_sanity",
    "mode_rules",
  ], // 收容基金会
  galgame_strategy: [
    "cheat_save_load",
    "rel_shuraba",
    "mode_liar_game",
    "cheat_insight",
  ], // 恋爱攻略
  npc_awakening: [
    "mode_fourth_scourge",
    "cheat_bug_fixer",
    "mode_behind_scenes",
    "mode_game_invades",
  ], // NPC觉醒
  infinite: ["mode_infinite_flow", "mode_survival", "cheat_exchange_shop"], // 无限流
  national_destiny: ["mode_national", "mode_stream", "cheat_resource_multiply"], // 国运

  // --- 6. ACG / 二次元板块 ---
  isekai_invincible: [
    "mode_invincible_start",
    "char_salted_fish",
    "rel_group_pet",
  ], // 异界无敌
  fanfiction: ["mode_book_trans", "mode_comparison", "rel_reunion"], // 同人
  system_game: ["cheat_level_up", "cheat_proficiency", "mode_tower_defense"], // 游戏系统
  comedy_gag: ["char_social_terrorist", "mode_abstract", "rel_cp_sculpture"], // 搞笑吐槽
  virtual_streamer: ["mode_stream", "char_social_phobic", "rel_guide"], // 虚拟主播
  esports: ["char_decisive", "mode_fast_paced", "rel_brotherhood"], // 电竞竞技
  teacher_student: ["mode_teacher", "rel_master_disciple", "mode_daily_romcom"], // 师生档案风
  original_vs_parallel: [
    "mode_comparison_live",
    "mode_exposure",
    "rel_reunion",
  ], // 双对比观影
  villain_reborn: ["char_villain", "mode_regret_male", "rel_crematorium"], // 反派重生
  daily_romcom: ["mode_slice_of_life", "rel_shuraba", "char_mask"], // 恋爱喜剧
  slice_of_life_acg: [
    "mode_slice_of_life",
    "char_salted_fish",
    "mode_abstract",
  ], // 综漫日常
  gender_bender: ["char_mask", "rel_identity_gap", "mode_body_swap"], // 变身TS
  hp_magic: ["mode_academy", "cheat_knowledge", "mode_secret_realm"], // 魔法学院HP
  superhero_comic: [
    "char_decisive",
    "mode_global_mutation",
    "cheat_black_tech",
  ], // 美漫超级英雄
  shonen_hot: ["char_decisive", "rel_brotherhood", "mode_tournament"], // 热血漫
  pokemon_battle: ["mode_beast_evolution", "char_sober", "rel_guide"], // 宝可梦对战

  // --- 7. 历史与战争板块 ---
  history_reform: ["cheat_knowledge", "mode_farming_war", "char_decisive"], // 历史争霸
  wuxia_traditional: ["char_decisive", "rel_brotherhood", "mode_tournament"], // 传统武侠
  time_travel: ["cheat_retro", "cheat_knowledge", "mode_farming_war"], // 历史穿越
  historical_fiction: [
    "cheat_knowledge",
    "mode_court_intrigue",
    "char_decisive",
  ], // 历史架空
  ancient_martial: ["char_decisive", "rel_brotherhood", "mode_tournament"], // 古武江湖
  court_intrigue: [
    "mode_court_intrigue",
    "char_black_belly",
    "rel_harem_fight",
  ], // 宫廷权谋
  war_strategy: ["char_decisive", "mode_farming_war", "cheat_knowledge"], // 战争谋略
  imperial_exam: ["mode_scholar", "mode_face_slap", "mode_court_intrigue"], // 科举文魁
  republican_spy: ["mode_spy", "char_mask", "mode_undercover_boss"], // 谍战特工
  industrial_revolution: [
    "cheat_black_tech",
    "mode_farming_war",
    "mode_national",
  ], // 工业基建
  three_kingdoms: ["mode_farming_war", "cheat_investment", "rel_brotherhood"], // 三国争霸
  ming_spy: ["mode_spy", "char_mask", "mode_undercover_boss"], // 大明锦衣卫
  qin_empire: ["mode_farming_war", "char_decisive", "mode_national"], // 大秦强国

  // --- 8. 西幻与游戏板块 ---
  epic_magic: ["mode_academy", "cheat_knowledge", "mode_secret_realm"], // 传统西幻
  lord_building: [
    "mode_farming_war",
    "cheat_summon_army",
    "mode_fourth_scourge",
  ], // 领主种田
  cthulhu_steampunk: ["mode_scp", "mode_acting_method", "char_mental"], // 诡秘蒸汽
  dungeon: ["mode_secret_realm", "mode_escape", "cheat_level_up"], // 地下城探险
  game_world: ["cheat_level_up", "mode_fourth_scourge", "cheat_bug_fixer"], // 游戏异界
  magic_academy: ["mode_academy", "cheat_knowledge", "mode_tournament"], // 魔法学院
  dragon_knight: ["mode_beast_evolution", "char_decisive", "rel_brotherhood"], // 龙骑士
  villainess_noble: ["mode_book_trans", "mode_be_aesthetic", "rel_crematorium"], // 恶役千金
  god_simulator: ["mode_behind_scenes", "cheat_creation", "mode_sect_building"], // 神明模拟
  wizard_farming: ["mode_scholar", "cheat_black_tech", "mode_farming_war"], // 巫师种田
  necromancer: ["cheat_clone_army", "char_villain", "aesthetic_grimdark"], // 亡灵法师
  druid_nature: ["mode_beast_evolution", "char_sober", "aesthetic_cozy"], // 德鲁伊
  abyss_demon: ["char_villain", "cheat_devour", "aesthetic_grimdark"], // 深渊恶魔

  // --- 9. 生活与职场板块 ---
  farming_rural: [
    "mode_slice_of_life",
    "aesthetic_cozy",
    "cheat_portable_space",
  ], // 种田归园
  gourmet: ["mode_slice_of_life", "char_foodie", "aesthetic_cozy"], // 美食厨神
  sports_legend: ["char_decisive", "mode_fast_paced", "rel_brotherhood"], // 体育竞技
  pet_cafe: ["mode_slice_of_life", "aesthetic_cozy", "rel_sweet_pet"], // 萌宠咖啡
  handicraft: ["mode_slice_of_life", "char_workaholic", "aesthetic_cozy"], // 手工匠人
  metaphysics_stream: ["mode_stream", "cheat_insight", "mode_urban_legend"], // 玄学直播
  culture_heritage: ["mode_scholar", "mode_culture_copy", "aesthetic_cozy"], // 非遗国潮
  vanlife_camping: ["mode_slice_of_life", "aesthetic_cozy", "char_sober"], // 房车荒野
  football_glory: ["char_decisive", "mode_fast_paced", "rel_brotherhood"], // 足球绿茵
  fishing_master: ["char_salted_fish", "mode_slice_of_life", "aesthetic_cozy"], // 钓鱼大师
  wilderness_survival: ["mode_escape", "char_decisive", "mode_slice_of_life"], // 荒野求生
  medical: ["mode_doctor", "cheat_insight", "mode_face_slap"], // 医生医疗
  entertainment_pro: [
    "mode_entertainment_circle",
    "mode_culture_copy",
    "rel_fan_circle",
  ], // 文娱名利
  detective: ["mode_detective", "cheat_voice_reveal", "mode_suspense"], // 刑侦法医
  lawyer: ["mode_spy", "char_decisive", "mode_face_slap"], // 律师法务
  teacher: ["mode_teacher", "rel_master_disciple", "mode_scholar"], // 教师教育
  criminal_psychology: ["mode_detective", "cheat_insight", "char_scientific"], // 心理侧写
  diplomat: ["mode_spy", "char_decisive", "mode_national"], // 外交翻译
  forensic_artist: ["mode_detective", "cheat_insight", "mode_suspense"], // 模拟画像师
};

// --- 🎨 辅助函数：动态获取 Badge 颜色样式 ---
const getBadgeStyle = (id: string, isSelected: boolean) => {
  const baseClass = "border transition-all duration-200";

  if (id.startsWith("cheat_")) {
    return isSelected
      ? `${baseClass} bg-amber-500 border-amber-600 text-white shadow-md shadow-amber-100`
      : `${baseClass} bg-amber-50/50 text-amber-700/80 border-amber-200/60 hover:bg-amber-100 hover:border-amber-300`;
  }
  if (id.startsWith("mode_")) {
    return isSelected
      ? `${baseClass} bg-blue-500 border-blue-600 text-white shadow-md shadow-blue-100`
      : `${baseClass} bg-blue-50/50 text-blue-700/80 border-blue-200/60 hover:bg-blue-100 hover:border-blue-300`;
  }
  if (id.startsWith("char_")) {
    return isSelected
      ? `${baseClass} bg-purple-500 border-purple-600 text-white shadow-md shadow-purple-100`
      : `${baseClass} bg-purple-50/50 text-purple-700/80 border-purple-200/60 hover:bg-purple-100 hover:border-purple-300`;
  }
  if (id.startsWith("rel_")) {
    return isSelected
      ? `${baseClass} bg-rose-500 border-rose-600 text-white shadow-md shadow-rose-100`
      : `${baseClass} bg-rose-50/50 text-rose-700/80 border-rose-200/60 hover:bg-rose-100 hover:border-rose-300`;
  }
  if (id.startsWith("aesthetic_") || id.startsWith("cultivation_")) {
    return isSelected
      ? `${baseClass} bg-emerald-500 border-emerald-600 text-white shadow-md shadow-emerald-100`
      : `${baseClass} bg-emerald-50/50 text-emerald-700/80 border-emerald-200/60 hover:bg-emerald-100 hover:border-emerald-300`;
  }
  // 默认
  return isSelected
    ? `${baseClass} bg-slate-700 border-slate-800 text-white shadow-md`
    : `${baseClass} bg-slate-50/50 text-slate-700/80 border-slate-200/60 hover:bg-slate-100 hover:border-slate-300`;
};

// --- 手风琴折叠项组件 ---
const AccordionItem = ({
  title,
  badge,
  isExpanded,
  onToggle,
  children,
}: {
  title: string;
  badge?: string | number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div className="border border-border/40 rounded-lg overflow-hidden bg-background/50">
    <button
      onClick={onToggle}
      className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-2">
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">{title}</span>
        {badge && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-4">
            {badge}
          </Badge>
        )}
      </div>
    </button>
    {isExpanded && <div className="border-t border-border/30">{children}</div>}
  </div>
);

// --- 类型选择器组件 (GenreSelector) ---
const GenreSelector = ({
  selectedIds,
  onToggle,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
}) => {
  const [activeGroup, setActiveGroup] = useState(Object.keys(GENRE_GROUPS)[0]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-3 flex-1">
        <div className="flex flex-wrap gap-2 border-b pb-2 border-border/50">
          {Object.keys(GENRE_GROUPS).map((groupName) => (
            <button
              key={groupName}
              onClick={() => setActiveGroup(groupName)}
              className={`
              text-xs px-2.5 py-1 rounded-full transition-all font-medium
              ${
                activeGroup === groupName
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }
            `}
            >
              {groupName}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 content-start">
          {GENRE_GROUPS[activeGroup as keyof typeof GENRE_GROUPS].map(
            (opt: NovelOption) => {
              const isSelected = selectedIds.includes(opt.id);
              return (
                <Badge
                  key={opt.id}
                  variant={isSelected ? "default" : "outline"}
                  className={`
                  cursor-pointer transition-all px-2.5 py-1 text-xs h-7 select-none
                  ${
                    isSelected
                      ? "bg-primary hover:bg-primary/90 shadow-sm scale-105"
                      : "bg-background hover:bg-accent hover:text-accent-foreground border-muted-foreground/20"
                  }
                `}
                  onClick={() => onToggle(opt.id)}
                  title={opt.description}
                >
                  {opt.label}
                </Badge>
              );
            }
          )}
        </div>
      </div>

      {/* 已选类型预览 (底部) */}
      {selectedIds.length > 0 && (
        <div className="border-t border-border/30 p-2 bg-muted/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground">
              已选 {selectedIds.length} 个核心类型
            </span>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[40px] overflow-y-auto">
            {selectedIds.map((id) => {
              // 查找对应的 Label
              const genre = NOVEL_GENRES.find((g) => g.id === id);
              if (!genre) return null;

              return (
                <div
                  key={id}
                  className="flex items-center gap-1 bg-background border px-2 py-1 rounded text-[10px] shadow-sm cursor-pointer hover:bg-destructive/10 hover:border-destructive/30 group/tag"
                  onClick={() => onToggle(id)}
                  title="点击移除"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="group-hover/tag:line-through decoration-destructive/50">
                    {genre.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// --- 篇幅选择器组件 (WordCountSelector) - 网格紧凑版 ---
const WordCountSelector = ({
  selectedId,
  onToggle,
}: {
  selectedId: string;
  onToggle: (opt: NovelOption) => void;
}) => (
  <div className="p-3">
    <div className="grid grid-cols-2 gap-2">
      {WORD_COUNTS.map((opt) => {
        const isSelected = selectedId === opt.id;
        return (
          <div
            key={opt.id}
            className={`
              cursor-pointer transition-all px-2 py-1.5 text-xs rounded-md border flex items-center justify-center text-center
              ${
                isSelected
                  ? "bg-primary text-primary-foreground border-primary font-medium shadow-sm"
                  : "bg-background hover:bg-accent text-muted-foreground border-muted"
              }
            `}
            onClick={() => onToggle(opt)}
            title={opt.description}
          >
            {opt.label.split(" ")[0]}
            <span className="text-[10px] opacity-70 ml-1 scale-90">
              {opt.label.match(/\((.*?)\)/)?.[1]}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

// --- 标签选择器组件 (TagSelector) - 带智能推荐 ---
const TagSelector = ({
  selectedIds,
  onToggle,
  recommendedIds = [],
}: {
  selectedIds: string[];
  onToggle: (opt: NovelOption) => void;
  recommendedIds?: string[];
}) => {
  const [activeCategory, setActiveCategory] = useState("🔥 2025新风口");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAll, setShowAll] = useState(false);

  // ✅ 优化：当没有推荐标签时，默认高亮"2025新风口"分类的标签
  const highlightedTags = useMemo(() => {
    if (recommendedIds.length > 0) {
      return recommendedIds;
    }
    // 当没有推荐标签时，返回"2025新风口"分类的标签ID作为高亮标签
    return NOVEL_TAGS.filter((tag) =>
      [
        // --- 核心机制 ---
        "cheat_cashback", // 返还系统
        "cheat_simplification", // 简化系统
        "cheat_emotion_points", // 情绪收集
        "cheat_future_diary", // 未来日记
        "cheat_voice_reveal", // 心声泄露
        "cheat_simulation", // 模拟器
        "cheat_advice", // 听劝
        "cheat_voice", // 偷听心声
        "cheat_knowledge", // 知识降维
        "cheat_retro", // 年代倒爷
        "cheat_empathy", // 听劝/好感度
        // --- 热门剧情 ---
        "mode_rules", // 规则怪谈
        "mode_national", // 上交国家/国运
        "mode_abstract", // 抽象乐子人
        "mode_fast_paced", // 短剧风快节奏
        "mode_comparison_live", // 双对比审判
        "mode_family_rise", // 家族修仙
        "mode_stepmother", // 后妈养崽
        "mode_dihua", // 迪化脑补
        "mode_acting_method", // 扮演法
        "mode_regret_male", // 男主悔过
        "mode_comparison", // 双对比/对照组
        "mode_invitation", // 诸天盘点/邀请函
        "mode_sect_building", // 宗门建设/掌门
        "mode_farming_war", // 种田争霸
        "mode_entertainment_circle", // 文娱/抄歌
        "mode_doctor", // 神医/悬壶
        "mode_detective", // 探案/悬疑
        // --- 热门人设 ---
        "char_mental", // 精神病
        "char_lying_flat", // 摆烂
        "rel_guide_sentinel", // 哨兵向导
        "mode_beast_evolution", // 御兽进化
        "char_salted_fish", // 咸鱼/摆烂
        "char_social_terrorist", // 社牛/社交悍匪
        "char_social_phobic", // 社恐/自闭
        "char_mask", // 戏精/影帝
        "char_decisive", // 杀伐果断
        "char_villain", // 大反派/魔头
        // --- 热门关系 ---
        "rel_crematorium", // 追妻火葬场
        "rel_shuraba", // 修罗场/白学
        "rel_master_disciple", // 冲师逆徒
        "reunion", // 破镜重圆/久别
        "rel_brotherhood", // 兄弟情/知己
        "rel_sweet_pet", // 甜宠/爹系
        "rel_enemy_lovers", // 相爱相杀/死对头
        "rel_savior", // 救命之恩/以身相许
        "rel_forced_marriage", // 先婚后爱/契约
        "rel_raising_wife", // 养成系/童养媳
        // --- 热门氛围 ---
        "aesthetic_cozy", // 治愈/田园
        "aesthetic_grimdark", // 黑暗/绝望
        "aesthetic_wasteland", // 废土/拾荒
        "aesthetic_steampunk", // 蒸汽朋克
        "cultivation_sword", // 剑修/剑道
        "cultivation_body", // 体修/肌肉
      ].includes(tag.id)
    ).map((tag) => tag.id);
  }, [recommendedIds]);

  // 🔥 手动维护的最新热门标签列表，确保所有新特性都能被看见
  const tagGroups: Record<string, NovelOption[]> = {
    "🔥 2025新风口": NOVEL_TAGS.filter((tag) =>
      [
        // --- 核心机制 ---
        "cheat_cashback", // 返还系统
        "cheat_simplification", // 简化系统
        "cheat_emotion_points", // 情绪收集
        "cheat_future_diary", // 未来日记
        "cheat_voice_reveal", // 心声泄露
        "cheat_simulation", // 模拟器
        "cheat_advice", // 听劝
        "cheat_voice", // 偷听心声
        "cheat_knowledge", // 知识降维
        "cheat_retro", // 年代倒爷
        "cheat_empathy", // 听劝/好感度
        // --- 热门剧情 ---
        "mode_rules", // 规则怪谈
        "mode_national", // 上交国家/国运
        "mode_abstract", // 抽象乐子人
        "mode_fast_paced", // 短剧风快节奏
        "mode_comparison_live", // 双对比审判
        "mode_family_rise", // 家族修仙
        "mode_stepmother", // 后妈养崽
        "mode_dihua", // 迪化脑补
        "mode_acting_method", // 扮演法
        "mode_regret_male", // 男主悔过
        "mode_comparison", // 双对比/对照组
        "mode_invitation", // 诸天盘点/邀请函
        "mode_sect_building", // 宗门建设/掌门
        "mode_farming_war", // 种田争霸
        "mode_entertainment_circle", // 文娱/抄歌
        "mode_doctor", // 神医/悬壶
        "mode_detective", // 探案/悬疑
        // --- 热门人设 ---
        "char_mental", // 精神病
        "char_lying_flat", // 摆烂
        "rel_guide_sentinel", // 哨兵向导
        "mode_beast_evolution", // 御兽进化
        "char_salted_fish", // 咸鱼/摆烂
        "char_social_terrorist", // 社牛/社交悍匪
        "char_social_phobic", // 社恐/自闭
        "char_mask", // 戏精/影帝
        "char_decisive", // 杀伐果断
        "char_villain", // 大反派/魔头
        // --- 热门关系 ---
        "rel_crematorium", // 追妻火葬场
        "rel_shuraba", // 修罗场/白学
        "rel_master_disciple", // 冲师逆徒
        "reunion", // 破镜重圆/久别
        "rel_brotherhood", // 兄弟情/知己
        "rel_sweet_pet", // 甜宠/爹系
        "rel_enemy_lovers", // 相爱相杀/死对头
        "rel_savior", // 救命之恩/以身相许
        "rel_forced_marriage", // 先婚后爱/契约
        "rel_raising_wife", // 养成系/童养媳
        // --- 热门氛围 ---
        "aesthetic_cozy", // 治愈/田园
        "aesthetic_grimdark", // 黑暗/绝望
        "aesthetic_wasteland", // 废土/拾荒
        "aesthetic_steampunk", // 蒸汽朋克
        "cultivation_sword", // 剑修/剑道
        "cultivation_body", // 体修/肌肉
      ].includes(tag.id)
    ),
    "🛠️ 核心金手指": NOVEL_TAGS.filter(
      (tag) => tag.id.startsWith("cheat_") || tag.id.startsWith("system_")
    ),
    "🎭 剧情与桥段": NOVEL_TAGS.filter((tag) => tag.id.startsWith("mode_")),
    "👤 人设与性格": NOVEL_TAGS.filter((tag) => tag.id.startsWith("char_")),
    "❤️ 情感与关系": NOVEL_TAGS.filter((tag) => tag.id.startsWith("rel_")),
    "🎨 氛围与修炼": NOVEL_TAGS.filter(
      (tag) =>
        tag.id.startsWith("aesthetic_") || tag.id.startsWith("cultivation_")
    ),
  };

  const getFilteredTags = () => {
    if (searchTerm) {
      return NOVEL_TAGS.filter(
        (tag) =>
          tag.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tag.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (showAll) return NOVEL_TAGS;
    return tagGroups[activeCategory] || [];
  };

  return (
    <div className="h-[350px] flex flex-col">
      {/* 搜索框 */}
      <div className="p-2 border-b border-border/30">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              if (e.target.value) setShowAll(false);
            }}
            placeholder="搜索标签..."
            className="h-7 text-xs pl-8 pr-8 bg-muted/30 border-muted-foreground/20 focus-visible:ring-1"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 分类选择 */}
      {!searchTerm && (
        <div className="p-2 pb-1 border-b border-border/20">
          <div className="flex flex-wrap gap-1">
            {Object.keys(tagGroups).map((categoryName) => (
              <button
                key={categoryName}
                onClick={() => {
                  setActiveCategory(categoryName);
                  setShowAll(false);
                }}
                className={`
                  text-[10px] px-2 py-0.5 rounded transition-all font-medium border
                  ${
                    !showAll && activeCategory === categoryName
                      ? "bg-secondary text-secondary-foreground border-secondary-foreground/20 shadow-sm"
                      : "bg-background text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
                  }
                `}
              >
                {categoryName}
              </button>
            ))}
            <button
              onClick={() => setShowAll(!showAll)}
              className={`
                text-[10px] px-2 py-0.5 rounded transition-all font-medium border
                ${
                  showAll
                    ? "bg-secondary text-secondary-foreground shadow-sm"
                    : "bg-background text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
                }
              `}
            >
              全部
            </button>
          </div>
        </div>
      )}

      {/* 标签列表 */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full" type="auto">
          <div className="p-2">
            <div className="flex flex-wrap gap-2 content-start">
              {getFilteredTags().map((opt: NovelOption) => {
                const isSelected = selectedIds.includes(opt.id);
                const isHighlighted = highlightedTags.includes(opt.id);
                const badgeStyle = getBadgeStyle(opt.id, isSelected);

                return (
                  <Badge
                    key={opt.id}
                    variant="outline"
                    className={`
                      cursor-pointer transition-all duration-200 px-3 py-1.5 text-sm h-auto min-h-[32px] select-none
                      ${badgeStyle}
                      ${
                        isSelected ? "scale-105 font-medium" : "hover:scale-105"
                      }
                       
                      /* ✅ 高亮样式：橙色光晕 + 边框 */
                      ${
                        !isSelected && isHighlighted
                          ? "ring-1 ring-orange-400/50 bg-orange-50/50 border-orange-300/50"
                          : ""
                      }
                    `}
                    onClick={() => onToggle(opt)}
                    title={opt.description}
                  >
                    {/* ✅ 高亮图标 */}
                    {isHighlighted && !isSelected && (
                      <Zap className="w-3 h-3 mr-1 text-orange-500 fill-orange-500 animate-pulse" />
                    )}
                    {opt.label}
                  </Badge>
                );
              })}
              {getFilteredTags().length === 0 && (
                <div className="w-full py-4 text-center text-xs text-muted-foreground">
                  未找到相关标签
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* 选中项预览 */}
      {selectedIds.length > 0 && (
        <div className="border-t border-border/30 p-2 bg-muted/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground">
              已选 {selectedIds.length} 个
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  NOVEL_TAGS.forEach(
                    (tag) => !selectedIds.includes(tag.id) && onToggle(tag)
                  )
                }
                className="h-6 text-[9px] px-2 text-muted-foreground"
              >
                全选
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  selectedIds.forEach((id) => {
                    const tag = NOVEL_TAGS.find((t) => t.id === id);
                    if (tag) onToggle(tag);
                  })
                }
                className="h-6 text-[9px] px-2 text-muted-foreground"
              >
                清空
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 max-h-[40px] overflow-y-auto">
            {selectedIds.slice(0, 8).map((id) => {
              const tag = NOVEL_TAGS.find((t) => t.id === id);
              if (!tag) return null;
              let dotClass = "bg-slate-400";
              if (id.startsWith("cheat")) dotClass = "bg-amber-500";
              if (id.startsWith("mode")) dotClass = "bg-blue-500";
              if (id.startsWith("char")) dotClass = "bg-purple-500";
              if (id.startsWith("rel")) dotClass = "bg-rose-500";

              return (
                <div
                  key={id}
                  className="flex items-center gap-1 bg-background border px-1.5 py-0.5 rounded text-[9px] shadow-sm cursor-pointer hover:bg-destructive/10 hover:border-destructive/30 group/tag"
                  onClick={() => onToggle(tag)}
                  title="点击移除"
                >
                  <div className={`w-1 h-1 rounded-full ${dotClass}`} />
                  <span className="group-hover/tag:line-through decoration-destructive/50 truncate max-w-[60px]">
                    {tag.label}
                  </span>
                </div>
              );
            })}
            {selectedIds.length > 8 && (
              <span className="text-[9px] text-muted-foreground px-1.5 py-0.5">
                +{selectedIds.length - 8}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// --- 主配置面板组件 ---
interface OutlineConfigPanelProps {
  selectedGenres: string[];
  setSelectedGenres: (
    genres: string[] | ((prev: string[]) => string[])
  ) => void;
  selectedWordCount: string;
  setSelectedWordCount: (count: string) => void;
  selectedTags: string[];
  setSelectedTags: (tags: string[] | ((prev: string[]) => string[])) => void;
  customPrompt: string;
  setCustomPrompt: (prompt: string) => void;
  isGenerating: boolean;
  isExtracting: boolean;
  tree: any[];
  onGenerateOutline: () => void;
  onExtractWorld: () => void;
  onApplyOutline: () => void;
}

export const OutlineConfigPanel: React.FC<OutlineConfigPanelProps> = ({
  selectedGenres,
  setSelectedGenres,
  selectedWordCount,
  setSelectedWordCount,
  selectedTags,
  setSelectedTags,
  customPrompt,
  setCustomPrompt,
  isGenerating,
  isExtracting,
  tree,
  onGenerateOutline,
  onExtractWorld,
  onApplyOutline,
}) => {
  // ✅ 引入 StyleStore 获取当前文风名称用于 Badge 显示
  const { getActiveStyle, activeStyleId } = useStyleStore();
  const activeStyleName = getActiveStyle().name;

  const [expandedSections, setExpandedSections] = useState({
    style: true, // ✅ 新增：默认展开文风配置
    genres: true,
    tags: true,
    prompt: true,
  });

  // ✅ 核心：根据选中的 Genre 计算推荐的 Tag
  const recommendedTags = useMemo(() => {
    const recommended = new Set<string>();
    selectedGenres.forEach((genreId) => {
      const tags = GENRE_TO_TAGS_MAP[genreId];
      if (tags) {
        tags.forEach((t) => recommended.add(t));
      }
    });
    return Array.from(recommended);
  }, [selectedGenres]);

  // ✅ 实时计算兼容性
  const compatibility = useMemo(() => {
    return styleCompatibilityService.checkCompatibility(
      activeStyleId,
      selectedGenres,
      selectedTags
    );
  }, [activeStyleId, selectedGenres, selectedTags]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleGenreToggle = (id: string) => {
    setSelectedGenres((prev: string[]) => {
      if (prev.includes(id)) {
        return prev.filter((item: string) => item !== id);
      } else {
        if (prev.length >= 3) {
          toast.warning("建议最多选择 3 个核心类型，以免 AI 逻辑混乱");
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  const handleTagToggle = (opt: NovelOption) => {
    setSelectedTags((prev: string[]) => {
      if (prev.includes(opt.id)) {
        return prev.filter((id: string) => id !== opt.id);
      } else {
        return [...prev, opt.id];
      }
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 头部标题 - 极致压缩 */}
      <div className="px-3 py-2 border-b border-border/50 shrink-0 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">AI 配置</h3>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1" type="hover">
          <div className="p-3 space-y-3">
            {/* 0. ✅ 文风配置 (新增) */}
            <AccordionItem
              title="文风与笔调"
              badge={activeStyleName}
              isExpanded={expandedSections.style}
              onToggle={() => toggleSection("style")}
            >
              <StyleConfigPanel />
            </AccordionItem>

            {/* ✅ 智能兼容性反馈 Banner (全新升级) */}
            {selectedGenres.length > 0 && (
              <div
                className={`
                  border rounded-md p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-1 transition-colors
                  ${
                    compatibility.level === "perfect"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : compatibility.level === "good"
                      ? "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400"
                      : compatibility.level === "risky"
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                      : compatibility.level === "conflict"
                      ? "bg-destructive/10 border-destructive/20 text-destructive"
                      : "bg-muted/30 border-border/50 text-muted-foreground"
                  }
                `}
              >
                {/* 动态图标 */}
                <div className="shrink-0 mt-0.5">
                  {compatibility.level === "perfect" && (
                    <Sparkles className="w-5 h-5" />
                  )}
                  {compatibility.level === "good" && (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                  {compatibility.level === "risky" && (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                  {compatibility.level === "conflict" && (
                    <AlertOctagon className="w-5 h-5" />
                  )}
                  {compatibility.level === "neutral" && (
                    <Info className="w-5 h-5" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-sm">
                      {compatibility.level === "perfect" &&
                        "完美契合 (AI 将超常发挥)"}
                      {compatibility.level === "good" && "风格契合度高"}
                      {compatibility.level === "neutral" && "风格匹配度一般"}
                      {compatibility.level === "risky" && "存在风格冲突"}
                      {compatibility.level === "conflict" && "严重逻辑冲突"}
                    </p>
                    <Badge
                      variant={
                        compatibility.score >= 80 ? "default" : "outline"
                      }
                      className={`text-[10px] h-5 ${
                        compatibility.score >= 90
                          ? "bg-emerald-500 hover:bg-emerald-600"
                          : ""
                      }`}
                    >
                      {compatibility.score}分
                    </Badge>
                  </div>

                  {/* 正面反馈 */}
                  {compatibility.suggestions.length > 0 && (
                    <ul className="list-disc list-inside opacity-90 text-xs space-y-0.5 mb-1">
                      {compatibility.suggestions.map((s, i) => (
                        <li key={`s-${i}`}>{s}</li>
                      ))}
                    </ul>
                  )}

                  {/* 负面警告 */}
                  {compatibility.issues.length > 0 && (
                    <ul className="list-disc list-inside opacity-90 text-xs space-y-0.5 font-medium mt-1">
                      {compatibility.issues.map((issue, i) => (
                        <li key={`i-${i}`}>{issue}</li>
                      ))}
                    </ul>
                  )}

                  {/* 提示语 */}
                  {compatibility.level === "risky" && (
                    <p className="text-[10px] opacity-70 mt-1.5">
                      建议：尝试更换文风，或添加"灵气复苏/赛博修仙"等桥接标签来融合设定。
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 1. 舞台与基调 (Genre) */}
            <AccordionItem
              title="舞台与基调"
              badge={
                selectedGenres.length > 0 ? selectedGenres.length : undefined
              }
              isExpanded={expandedSections.genres}
              onToggle={() => toggleSection("genres")}
            >
              <GenreSelector
                selectedIds={selectedGenres}
                onToggle={handleGenreToggle}
              />
            </AccordionItem>

            {/* 2. 核心元素 (Tags) - 带智能推荐 */}
            <AccordionItem
              title="核心元素"
              badge={selectedTags.length > 0 ? selectedTags.length : undefined}
              isExpanded={expandedSections.tags}
              onToggle={() => toggleSection("tags")}
            >
              <TagSelector
                selectedIds={selectedTags}
                onToggle={handleTagToggle}
                recommendedIds={recommendedTags}
              />
            </AccordionItem>

            {/* 3. 篇幅规划 (移出手风琴，网格布局) */}
            <div className="border rounded-lg bg-background/50 overflow-hidden">
              <div className="bg-muted/30 px-3 py-1.5 border-b text-xs font-medium text-muted-foreground">
                篇幅规划
              </div>
              <WordCountSelector
                selectedId={selectedWordCount}
                onToggle={(opt: NovelOption) => setSelectedWordCount(opt.id)}
              />
            </div>

            {/* 4. 具体构思 (紧凑版) */}
            <AccordionItem
              title="具体构思"
              badge={customPrompt.trim() ? "✓" : undefined}
              isExpanded={expandedSections.prompt}
              onToggle={() => toggleSection("prompt")}
            >
              <div className="p-2">
                <Textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="额外设定..."
                  className="resize-none h-16 text-xs p-2 focus-visible:ring-1"
                />
              </div>
            </AccordionItem>
          </div>
        </ScrollArea>
      </div>

      {/* 底部操作栏 - 网格布局极致省空间 */}
      <div className="p-2 border-t border-border/50 bg-muted/20 shrink-0 space-y-2">
        {/* 提示信息行 */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 h-4">
          <span>{selectedGenres.length === 0 ? "请选择类型" : "准备就绪"}</span>
          {isGenerating && <span>生成中...</span>}
        </div>

        {/* 按钮网格：上面两个辅助按钮并排，下面主按钮全宽 */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExtractWorld}
            disabled={isGenerating || isExtracting || tree.length === 0}
            className="h-8 text-xs border-dashed"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            提取设定
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onApplyOutline}
            disabled={isGenerating || tree.length === 0}
            className="h-8 text-xs"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            应用目录
          </Button>

          <Button
            onClick={onGenerateOutline}
            disabled={isGenerating || selectedGenres.length === 0}
            className="col-span-2 h-9 text-sm bg-gradient-to-r from-primary to-purple-600 hover:shadow-md transition-all"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand className="h-4 w-4 mr-2" />
            )}
            {isGenerating ? "正在思考..." : "开始智能规划"}
          </Button>
        </div>
      </div>
    </div>
  );
};
