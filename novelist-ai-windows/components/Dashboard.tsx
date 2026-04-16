import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useNovelListQuery,
  useDashboardStatsQuery,
  useActivityHeatmapQuery, // ✅ 新增
  useTodayActivityQuery, // ✅ 新增
} from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useNovelCreationDialog } from "./NovelCreationDialog";
import {
  Plus,
  Sparkles,
  PenTool,
  Activity,
  Quote,
  Search,
  FileText,
  ArrowUpRight,
  Filter,
  Target,
  Lightbulb,
  ChevronRight,
  MessageCircle, // ✅ 新增图标
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { ActivityHeatmap } from "./dashboard/ActivityHeatmap";
import { NovelBookCard } from "./dashboard/NovelBookCard";
import { MarketingBanner } from "./dashboard/MarketingBanner";

// 格式化数字
const formatNumber = (num: number, locale: "zh-CN" | "en-US") => {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(num);
};

// --- 每日目标组件 (接入真实数据) ---
const DailyGoalWidget = ({ count }: { count: number }) => {
  const { t } = useTranslation();
  // 假设每日目标是 20 次保存/更新 (可以做成可配置的)
  const target = 20;
  const percentage = Math.min(100, Math.round((count / target) * 100));

  return (
    <Card className="border-none shadow-sm bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 backdrop-blur-md h-full relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        <Target className="w-16 h-16" />
      </div>
      <CardContent className="p-5 flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 mb-1">
            <Target className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">
              {t("dashboard.dailyActive")}
            </span>
          </div>
          <div className="text-2xl font-bold font-['Plus_Jakarta_Sans']">
            {count}{" "}
            <span className="text-sm text-muted-foreground font-normal">
              / {target} {t("dashboard.submissions")}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t("dashboard.todaySaveSnapshotCount")}
          </div>
        </div>
        <div className="space-y-2 mt-4">
          <div className="h-2 w-full bg-violet-100 dark:bg-violet-900/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-[10px] text-right text-muted-foreground">
            {t("dashboard.completion", { percentage })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

// --- 灵感组件 (保持不变) ---
const InspirationWidget = () => {
  const { t } = useTranslation();
  return (
    <Card className="border-none shadow-sm bg-gradient-to-br from-amber-500/10 to-orange-500/10 backdrop-blur-md h-full relative overflow-hidden group cursor-pointer hover:border-amber-500/30 transition-all">
      <div className="absolute -right-4 -bottom-4 p-4 opacity-10 group-hover:opacity-20 transition-opacity rotate-12">
        <Lightbulb className="w-20 h-20" />
      </div>
      <CardContent className="p-5 flex flex-col h-full">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-3">
          <Lightbulb className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {t("dashboard.inspiration")}
          </span>
        </div>
        <p className="text-sm font-medium leading-relaxed line-clamp-3 flex-1">
          {t("dashboard.inspirationQuote")}
        </p>
        <div className="mt-3 flex items-center text-[10px] text-amber-600/70 font-medium group-hover:translate-x-1 transition-transform">
          {t("dashboard.useInspiration")} <ChevronRight className="w-3 h-3 ml-1" />
        </div>
      </CardContent>
    </Card>
  );
};

// ✅ 定义 Props 接口，接收 toggle 函数
interface DashboardProps {
  onOpenAiChat?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpenAiChat }) => {
  const { t } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const { setViewMode, setCurrentNovelTitle } = useUiStore();
  const { data: novels = [], isLoading: isListLoading } = useNovelListQuery();
  const { data: stats, isLoading: isStatsLoading } = useDashboardStatsQuery();
  // ✅ 获取真实数据
  const { data: heatmapData } = useActivityHeatmapQuery();
  const { data: todayActivity = 0 } = useTodayActivityQuery();

  const [_, __, NovelCreationDialog] = useNovelCreationDialog();
  const [searchQuery, setSearchQuery] = useState("");

  const handleOpenNovel = (title: string) => {
    setCurrentNovelTitle(title);
    setViewMode("editor");
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return t("dashboard.greeting.night");
    if (hour < 11) return t("dashboard.greeting.morning");
    if (hour < 14) return t("dashboard.greeting.noon");
    if (hour < 19) return t("dashboard.greeting.afternoon");
    return t("dashboard.greeting.evening");
  };

  const filteredNovels = useMemo(() => {
    return novels.filter((n) =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [novels, searchQuery]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F9F7F3] dark:bg-[#0c0c0e] relative">
      {/* ✅ 布局容器：w-full px-6, max-w-[1800px] 居中 */}
      <div className="w-full px-6 md:px-10 py-8 max-w-[1800px] mx-auto space-y-8">
        {/* --- Header Section --- */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border/40 pb-6">
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold font-['Lora'] tracking-tight text-foreground">
              {getGreeting()}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {t("dashboard.todayIs")}{" "}
              {new Date().toLocaleDateString(language, {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </p>
          </div>

          <div className="w-full md:w-auto flex items-center gap-3">
            <div className="relative group flex-1 md:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder={t("dashboard.searchWorks")}
                className="pl-9 bg-white/50 dark:bg-black/20 border-transparent hover:border-border/50 focus:bg-background w-full md:w-72 transition-all shadow-sm h-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <NovelCreationDialog
              trigger={
                <Button className="shadow-md hover:shadow-lg transition-all bg-primary text-primary-foreground h-10 px-6">
                  <Plus className="w-4 h-4 mr-2" /> {t("dashboard.newWork")}
                </Button>
              }
            />
          </div>
        </div>

        {/* --- Bento Grid Dashboard --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* 1. 基础统计 (1列) */}
          <div className="grid grid-cols-2 md:grid-cols-1 gap-4 lg:col-span-1">
            {[
              {
                label: t("dashboard.totalWordCount"),
                val: formatNumber(stats?.totalWordCount || 0, language),
                icon: PenTool,
                color: "text-blue-500",
                bg: "bg-blue-500/10",
              },
              {
                label: t("dashboard.totalChaptersLabel"),
                val: stats?.totalChapters || 0,
                icon: FileText,
                color: "text-orange-500",
                bg: "bg-orange-500/10",
              },
            ].map((s, i) => (
              <Card
                key={i}
                className="border-none shadow-sm bg-white/60 dark:bg-white/5 backdrop-blur-md"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div
                    className={cn("p-2.5 rounded-lg shrink-0", s.bg, s.color)}
                  >
                    <s.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xl font-bold font-['Plus_Jakarta_Sans'] leading-none">
                      {isStatsLoading ? "-" : s.val}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {s.label}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 2. 热力图 (2列) - 接入真实数据 */}
          <Card className="border-none shadow-sm bg-white/60 dark:bg-white/5 backdrop-blur-md md:col-span-2 lg:col-span-2 xl:col-span-2 overflow-hidden">
            <CardContent className="p-5 h-full flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />{" "}
                  {t("dashboard.creationHeat")}
                </h3>
                <div className="text-xs text-muted-foreground">
                  {/* 这里可以后续根据真实数据计算连续天数 */}
                  {t("dashboard.keepRecording")}
                </div>
              </div>
              <div className="w-full overflow-x-auto pb-1">
                {/* ✅ 传入真实数据 */}
                <ActivityHeatmap data={heatmapData} />
              </div>
            </CardContent>
          </Card>

          {/* 3. 每日目标 (1列) - 接入真实数据 */}
          <div className="md:col-span-1">
            <DailyGoalWidget count={todayActivity} />
          </div>

          {/* 4. 灵感/Banner (1列) */}
          <div className="md:col-span-2 lg:col-span-4 xl:col-span-1 h-full">
            <div className="hidden xl:block h-full">
              <InspirationWidget />
            </div>
            <div className="block xl:hidden">
              <MarketingBanner />
            </div>
          </div>
        </div>

        {/* 超宽屏 Banner */}
        <div className="hidden xl:block">
          <MarketingBanner />
        </div>

        {/* --- 书架区域 (Grid Layout Fix) --- */}
        <div className="space-y-6 pb-20">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold font-['Lora'] flex items-center gap-3">
              {t("dashboard.bookshelf")}
              <Badge
                variant="secondary"
                className="rounded-full px-2.5 text-xs bg-muted/50 font-normal text-muted-foreground"
              >
                {t("dashboard.bookshelfCount", { count: filteredNovels.length })}
              </Badge>
            </h2>
          </div>

          {/* ✅ 修复：使用标准 Grid，放弃 VirtuosoGrid，彻底解决布局错乱 */}
          {filteredNovels.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
              {filteredNovels.map((novel, index) => (
                <NovelBookCard
                  key={String(novel.id)}
                  id={String(novel.id)}
                  title={novel.title}
                  outline={novel.outline}
                  coverImage={novel.coverImage}
                  stats={{
                    volumes: novel.volumesCount,
                    chapters: novel.chaptersCount,
                    words: novel.wordCount,
                  }}
                  onClick={() => handleOpenNovel(novel.title)}
                  index={index}
                />
              ))}

              {/* 新建卡片总是放在最后 */}
              <NovelCreationDialog
                trigger={
                  <div className="h-full min-h-[16rem] w-full border-2 border-dashed border-muted-foreground/10 hover:border-primary/40 rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-accent/5 transition-all group text-muted-foreground hover:text-primary bg-white/30 dark:bg-white/5 backdrop-blur-sm">
                    <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-primary/10">
                      <Plus className="w-8 h-8" />
                    </div>
                    <span className="font-medium">
                      {t("dashboard.startNewJourney")}
                    </span>
                  </div>
                }
              />
            </div>
          ) : (
            // 空状态
            <div className="flex flex-col items-center justify-center py-24">
              <div className="w-24 h-24 bg-muted/30 rounded-full flex items-center justify-center mb-6">
                <PenTool className="w-10 h-10 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-medium text-foreground/80 mb-2">
                {t("dashboard.emptyBookshelfTitle")}
              </h3>
              <p className="text-muted-foreground mb-8">
                {t("dashboard.emptyBookshelfDescription")}
              </p>
              <NovelCreationDialog
                trigger={<Button size="lg">{t("dashboard.createFirstNovel")}</Button>}
              />
            </div>
          )}
        </div>
      </div>

      {/* ✅ 新增：悬浮 AI 对话按钮 (Floating Action Button) */}
      {onOpenAiChat && (
        <Button
          onClick={onOpenAiChat}
          className="fixed bottom-8 right-8 h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 text-primary-foreground z-50 transition-transform hover:scale-110 animate-in zoom-in duration-300"
          size="icon"
          title={t("dashboard.openFreeAiChat")}
        >
          <MessageCircle className="h-7 w-7" />
        </Button>
      )}
    </div>
  );
};
