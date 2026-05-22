"use client";

import {
  Sparkles,
  BookOpen,
  Wand2,
  Users,
  Zap,
  Globe,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Section } from "../section";

const features = [
  {
    icon: Wand2,
    label: "AI 创作",
    title: "智能辅助写作",
    description: "AI 帮你生成大纲、续写章节、润色文字，让创作更轻松",
    color: "from-violet-500/20 to-purple-500/20",
    borderColor: "border-violet-500/15",
    iconColor: "text-violet-400",
    hoverBorder: "hover:border-violet-400/30",
    shadowColor: "shadow-violet-500/10",
  },
  {
    icon: BookOpen,
    label: "海量书库",
    title: "丰富的小说资源",
    description: "涵盖玄幻、言情、科幻、悬疑等多种类型，满足不同口味",
    color: "from-amber-500/20 to-orange-500/20",
    borderColor: "border-amber-500/15",
    iconColor: "text-amber-400",
    hoverBorder: "hover:border-amber-400/30",
    shadowColor: "shadow-amber-500/10",
  },
  {
    icon: Sparkles,
    label: "个性化",
    title: "智能推荐系统",
    description: "根据你的阅读偏好，推荐最适合你的精彩故事",
    color: "from-cyan-500/20 to-blue-500/20",
    borderColor: "border-cyan-500/15",
    iconColor: "text-cyan-400",
    hoverBorder: "hover:border-cyan-400/30",
    shadowColor: "shadow-cyan-500/10",
  },
  {
    icon: Zap,
    label: "沉浸式",
    title: "极致阅读体验",
    description: "支持多种阅读模式、字体调节、夜间模式，舒适阅读",
    color: "from-emerald-500/20 to-teal-500/20",
    borderColor: "border-emerald-500/15",
    iconColor: "text-emerald-400",
    hoverBorder: "hover:border-emerald-400/30",
    shadowColor: "shadow-emerald-500/10",
  },
  {
    icon: Users,
    label: "社区互动",
    title: "读者交流社区",
    description: "与志同道合的读者交流心得，分享你的阅读感悟",
    color: "from-pink-500/20 to-rose-500/20",
    borderColor: "border-pink-500/15",
    iconColor: "text-pink-400",
    hoverBorder: "hover:border-pink-400/30",
    shadowColor: "shadow-pink-500/10",
  },
  {
    icon: Globe,
    label: "全平台",
    title: "随时随地阅读",
    description: "支持 Web、移动端多端同步，书架云端备份",
    color: "from-blue-500/20 to-indigo-500/20",
    borderColor: "border-blue-500/15",
    iconColor: "text-blue-400",
    hoverBorder: "hover:border-blue-400/30",
    shadowColor: "shadow-blue-500/10",
  },
];

export function FeaturesSection({ className }: { className?: string }) {
  return (
    <Section
      className={cn("relative", className)}
      title="平台特色"
      subtitle="MiaoWu Novel 为你提供全方位的阅读与创作体验"
    >
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-amber-500/[0.02] to-transparent" />

      <div className="container-md relative mt-8 grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3 md:px-20">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.label}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-white/[0.02] p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
                feature.borderColor,
                feature.hoverBorder,
                feature.shadowColor
              )}
            >
              {/* Background gradient */}
              <div
                className={cn(
                  "absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100",
                  feature.color
                )}
              />

              <div className="relative z-10">
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-white/10 to-white/5 shadow-inner",
                    )}
                  >
                    <Icon className={cn("size-5", feature.iconColor)} />
                  </div>
                  <span className="text-xs font-medium uppercase tracking-wider text-white/40">
                    {feature.label}
                  </span>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white/90 transition-colors group-hover:text-amber-300">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-white/50">
                  {feature.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
