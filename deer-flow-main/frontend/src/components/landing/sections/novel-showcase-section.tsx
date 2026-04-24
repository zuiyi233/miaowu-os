"use client";

import {
  BookOpen,
  FileText,
  Layers,
  PenTool,
  GitBranch,
  Clock,
  Trophy,
  Flag,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

import {
  useAnimeEntrance,
  useSpringEntrance,
  useParallaxScroll,
  animate,
} from "@/lib/anime";

const workspaceViews = [
  { icon: PenTool, title: "编辑器", description: "富文本编辑器支持 AI 续写、润色、局部重生成", color: "text-amber-400" },
  { icon: BookOpen, title: "阅读模式", description: "沉浸式阅读体验，支持目录导航和书签", color: "text-rose-400" },
  { icon: Layers, title: "大纲管理", description: "可视化大纲结构，拖拽调整章节顺序", color: "text-cyan-400" },
  { icon: Clock, title: "时间线", description: "梳理故事时间线，管理多线叙事", color: "text-violet-400" },
  { icon: GitBranch, title: "关系图谱", description: "交互式角色关系图谱，一目了然", color: "text-emerald-400" },
  { icon: Trophy, title: "职业体系", description: "设计角色职业、技能、成长路线", color: "text-amber-300" },
  { icon: Flag, title: "伏笔管理", description: "追踪故事伏笔，确保前后呼应", color: "text-indigo-400" },
  { icon: FileText, title: "设定管理", description: "世界观、组织势力、魔法体系设定", color: "text-teal-400" },
];

function ViewCard({ view }: { view: (typeof workspaceViews)[0] }) {
  const Icon = view.icon;

  return (
    <div
      data-view
      className="group relative flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-sm"
      style={{ opacity: 0 }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        animate(el, {
          translateY: -8,
          borderColor: "rgba(245,158,11,0.3)",
          duration: 400,
          ease: "spring(1, 0.5, 10, 0)",
        });
        const iconWrap = el.querySelector(".view-icon")!;
        if (iconWrap) {
          animate(iconWrap, {
            scale: [1, 1.2],
            rotate: [0, -5],
            duration: 400,
            ease: "spring(1, 0.6, 8, 0)",
          });
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        animate(el, {
          translateY: 0,
          borderColor: "rgba(255,255,255,0.06)",
          duration: 500,
          ease: "spring(1, 0.4, 12, 0)",
        });
        const iconWrap = el.querySelector(".view-icon")!;
        if (iconWrap) {
          animate(iconWrap, {
            scale: [1.2, 1],
            rotate: [-5, 0],
            duration: 500,
            ease: "spring(1, 0.4, 12, 0)",
          });
        }
      }}
    >
      <div className="view-icon mb-3 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10">
        <Icon className={`size-6 ${view.color}/80`} />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-white/80">
        {view.title}
      </h3>
      <p className="text-center text-xs leading-relaxed text-white/40">
        {view.description}
      </p>
    </div>
  );
}

export function NovelShowcaseSection() {
  const headerRef = useAnimeEntrance("[data-animate]");
  const gridRef = useSpringEntrance("[data-view]", {
    delay: 60,
    bounce: 0.2,
    duration: 1000,
  });
  const parallaxRef = useParallaxScroll("[data-parallax]", 0.05);

  return (
    <section ref={headerRef} className="relative w-full py-24">
      <SectionDivider />

      <div ref={parallaxRef} className="container-md relative mx-auto max-w-[1200px] px-4 md:px-8">
        <div
          className="pointer-events-none absolute -top-20 left-1/4 size-72 rounded-full opacity-10"
          data-parallax
          style={{
            background: "radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />

        <div className="mb-4 text-center" data-animate style={{ opacity: 0 }}>
          <span className="text-sm font-medium uppercase tracking-wider text-white/40">
            工作空间
          </span>
        </div>
        <h2
          className="mb-4 text-center text-3xl font-bold text-white/90 md:text-4xl"
          data-animate style={{ opacity: 0 }}
        >
          一站式小说创作工作台
        </h2>
        <p
          className="mx-auto mb-12 max-w-2xl text-center text-lg text-white/50"
          data-animate style={{ opacity: 0 }}
        >
          8 大核心视图，覆盖小说创作的全流程需求
        </p>

        <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {workspaceViews.map((view) => (
            <ViewCard key={view.title} view={view} />
          ))}
        </div>

        <div className="mt-10 flex justify-center" data-animate style={{ opacity: 0 }}>
          <Link
            href="/workspace/novel"
            className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm text-white/70 backdrop-blur-sm transition-colors duration-300 hover:border-amber-500/30 hover:bg-white/[0.06] hover:text-amber-300"
            onMouseEnter={(e) => {
              animate(e.currentTarget, {
                scale: [1, 1.05],
                duration: 400,
                ease: "spring(1, 0.5, 10, 0)",
              });
            }}
            onMouseLeave={(e) => {
              animate(e.currentTarget, {
                scale: [1.05, 1],
                duration: 500,
                ease: "spring(1, 0.4, 12, 0)",
              });
            }}
          >
            进入创作空间
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
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
          background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.3), transparent)",
        }}
      />
    </div>
  );
}
