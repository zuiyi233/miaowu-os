"use client";

import {
  Wand2,
  Brain,
  Users,
  GitBranch,
  Shield,
  Zap,
  BookOpen,
  Sparkles,
} from "lucide-react";

import {
  useAnimeEntrance,
  useSpringEntrance,
  animate,
} from "@/lib/anime";

const deerFlowFeatures = [
  {
    icon: Brain,
    title: "超级智能体框架",
    description:
      "基于 LangGraph 构建的超级智能体 harness，支持子智能体编排、长期记忆、沙箱执行，让 AI 真正完成复杂任务。",
    color: "from-amber-500/20 to-orange-500/20",
    borderColor: "border-amber-500/15",
    iconColor: "text-amber-400",
    glowColor: "rgba(245,158,11,0.15)",
  },
  {
    icon: GitBranch,
    title: "子智能体分解",
    description:
      "复杂任务自动分解为多个子智能体并行执行，各自拥有独立上下文和工具集，最终汇总为完整输出。",
    color: "from-cyan-500/20 to-blue-500/20",
    borderColor: "border-cyan-500/15",
    iconColor: "text-cyan-400",
    glowColor: "rgba(6,182,212,0.15)",
  },
  {
    icon: Shield,
    title: "安全沙箱执行",
    description:
      "每个任务在隔离沙箱中运行，支持 Docker 容器化执行。AI 可以安全地读写文件、执行命令、生成交付物。",
    color: "from-emerald-500/20 to-teal-500/20",
    borderColor: "border-emerald-500/15",
    iconColor: "text-emerald-400",
    glowColor: "rgba(16,185,129,0.15)",
  },
  {
    icon: Zap,
    title: "技能与工具扩展",
    description:
      "内置研究、报告生成、网页创建、图像生成等技能。支持通过 MCP 服务器和 Python 函数自定义扩展。",
    color: "from-violet-500/20 to-purple-500/20",
    borderColor: "border-violet-500/15",
    iconColor: "text-violet-400",
    glowColor: "rgba(139,92,246,0.15)",
  },
];

const novelFeatures = [
  {
    icon: BookOpen,
    title: "AI 辅助小说创作",
    description:
      "从大纲生成到章节续写，AI 全程辅助创作。支持世界观设定、角色关系图谱、伏笔管理等专业功能。",
    color: "from-rose-500/20 to-pink-500/20",
    borderColor: "border-rose-500/15",
    iconColor: "text-rose-400",
    glowColor: "rgba(244,63,94,0.15)",
  },
  {
    icon: Users,
    title: "角色与关系管理",
    description:
      "可视化角色关系图谱，管理角色职业体系、组织势力。让每个角色都有完整的背景故事和成长轨迹。",
    color: "from-indigo-500/20 to-blue-500/20",
    borderColor: "border-indigo-500/15",
    iconColor: "text-indigo-400",
    glowColor: "rgba(99,102,241,0.15)",
  },
  {
    icon: Sparkles,
    title: "智能润色与改写",
    description:
      "AI 实时分析章节内容，提供润色建议、风格调整、局部重生成。保持创作连贯性的同时提升文笔。",
    color: "from-amber-500/20 to-yellow-500/20",
    borderColor: "border-amber-500/15",
    iconColor: "text-amber-400",
    glowColor: "rgba(245,158,11,0.15)",
  },
  {
    icon: Wand2,
    title: "灵感模式",
    description:
      "当创作遇到瓶颈时，灵感模式帮你生成情节转折、对话片段、场景描写。让灵感永不枯竭。",
    color: "from-teal-500/20 to-emerald-500/20",
    borderColor: "border-teal-500/15",
    iconColor: "text-teal-400",
    glowColor: "rgba(20,184,166,0.15)",
  },
];

function FeatureCard({
  feature,
}: {
  feature: (typeof deerFlowFeatures)[0];
}) {
  const Icon = feature.icon;

  return (
    <div
      data-card
      className="group relative overflow-hidden rounded-xl border bg-white/[0.02] p-6 backdrop-blur-sm transition-colors duration-300"
      style={{
        opacity: 0,
        borderColor: "rgba(255,255,255,0.06)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = feature.glowColor.replace("0.15", "0.4");
        el.style.boxShadow = `0 0 30px ${feature.glowColor}, inset 0 0 30px ${feature.glowColor.replace("0.15", "0.05")}`;
        const overlay = el.querySelector(".card-overlay") as HTMLElement | null;
        if (overlay) overlay.style.opacity = "1";
        const icon = el.querySelector(".card-icon") as HTMLElement | null;
        if (icon) {
          animate(icon, {
            scale: [1, 1.15],
            rotate: [0, 5],
            duration: 400,
            ease: "spring(1, 0.5, 10, 0)",
          });
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(255,255,255,0.06)";
        el.style.boxShadow = "none";
        const overlay = el.querySelector(".card-overlay") as HTMLElement | null;
        if (overlay) overlay.style.opacity = "0";
        const icon = el.querySelector(".card-icon") as HTMLElement | null;
        if (icon) {
          animate(icon, {
            scale: [1.15, 1],
            rotate: [5, 0],
            duration: 500,
            ease: "spring(1, 0.4, 12, 0)",
          });
        }
      }}
    >
      <div
        className={`card-overlay absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 transition-opacity duration-300`}
      />
      <div className="relative z-10">
        <div className="mb-4 flex items-center gap-3">
          <div className="card-icon flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-white/10 to-white/5 shadow-inner">
            <Icon className={`size-5 ${feature.iconColor}`} />
          </div>
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
}

export function CoreFeaturesSection() {
  const sectionRef = useAnimeEntrance("[data-animate]");
  const cardsRef = useSpringEntrance("[data-card]", {
    delay: 80,
    bounce: 0.25,
    duration: 1200,
  });

  return (
    <section ref={sectionRef} className="relative w-full py-24">
      <SectionDivider />

      <div className="container-md relative mx-auto max-w-[1200px] px-4 md:px-8">
        <div className="mb-4 text-center" data-animate style={{ opacity: 0 }}>
          <span className="text-sm font-medium uppercase tracking-wider text-white/40">
            DeerFlow 核心
          </span>
        </div>
        <h2
          className="mb-4 text-center text-3xl font-bold text-white/90 md:text-4xl"
          data-animate style={{ opacity: 0 }}
        >
          超级智能体 Harness
        </h2>
        <p
          className="mx-auto mb-12 max-w-2xl text-center text-lg text-white/50"
          data-animate style={{ opacity: 0 }}
        >
          不仅仅是聊天机器人，而是能够规划、执行、交付完整任务的超级智能体运行时
        </p>

        <div ref={cardsRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {deerFlowFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>

        <div className="mb-4 mt-20 text-center" data-animate style={{ opacity: 0 }}>
          <span className="text-sm font-medium uppercase tracking-wider text-white/40">
            MiaoWu Novel
          </span>
        </div>
        <h2
          className="mb-4 text-center text-3xl font-bold text-white/90 md:text-4xl"
          data-animate style={{ opacity: 0 }}
        >
          专业小说创作套件
        </h2>
        <p
          className="mx-auto mb-12 max-w-2xl text-center text-lg text-white/50"
          data-animate style={{ opacity: 0 }}
        >
          为小说创作者量身打造的专业工具集，从构思到成书的全流程 AI 辅助
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {novelFeatures.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionDivider() {
  return (
    <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-1/2">
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div
        className="mx-auto mt-[-1px] h-1 w-16 rounded-full"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)",
        }}
      />
    </div>
  );
}
