"use client";

import {
  Cpu,
  Globe,
  Database,
  Server,
  Workflow,
  MessageSquare,
  BookOpen,
  Code2,
} from "lucide-react";
import {
  useAnimeEntrance,
  useSpringEntrance,
  animate,
} from "@/lib/anime";

const techItems = [
  { icon: Workflow, name: "LangGraph", description: "智能体编排框架" },
  { icon: Cpu, name: "LangChain", description: "LLM 应用开发框架" },
  { icon: MessageSquare, name: "多模型支持", description: "OpenAI / Claude / Gemini / Qwen" },
  { icon: Server, name: "Next.js 16", description: "全栈 React 框架" },
  { icon: Database, name: "PostgreSQL", description: "关系型数据持久化" },
  { icon: Globe, name: "WebGL", description: "GPU 加速粒子渲染" },
  { icon: BookOpen, name: "小说引擎", description: "专业创作工具链" },
  { icon: Code2, name: "TypeScript", description: "类型安全开发" },
];

function TechCard({ tech }: { tech: (typeof techItems)[0] }) {
  const Icon = tech.icon;

  return (
    <div
      data-tech
      className="group flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-4 backdrop-blur-sm"
      style={{ opacity: 0 }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        animate(el, {
          translateY: -4,
          borderColor: "rgba(245,158,11,0.3)",
          boxShadow: "0 0 20px rgba(245,158,11,0.08)",
          duration: 400,
          ease: "spring(1, 0.5, 10, 0)",
        });
        const icon = el.querySelector(".tech-icon") as HTMLElement;
        if (icon) {
          animate(icon, {
            scale: [1, 1.2],
            rotate: [0, 10],
            duration: 400,
            ease: "spring(1, 0.6, 8, 0)",
          });
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        animate(el, {
          translateY: 0,
          borderColor: "rgba(255,255,255,0.05)",
          boxShadow: "0 0 0px rgba(245,158,11,0)",
          duration: 500,
          ease: "spring(1, 0.4, 12, 0)",
        });
        const icon = el.querySelector(".tech-icon") as HTMLElement;
        if (icon) {
          animate(icon, {
            scale: [1.2, 1],
            rotate: [10, 0],
            duration: 500,
            ease: "spring(1, 0.4, 12, 0)",
          });
        }
      }}
    >
      <div className="tech-icon flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02]">
        <Icon className="size-4 text-white/50 transition-colors duration-300 group-hover:text-amber-400" />
      </div>
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-white/70">
          {tech.name}
        </h4>
        <p className="text-xs text-white/30">{tech.description}</p>
      </div>
    </div>
  );
}

export function TechStackSection() {
  const sectionRef = useAnimeEntrance("[data-animate]");
  const gridRef = useSpringEntrance("[data-tech]", {
    delay: 60,
    bounce: 0.2,
    duration: 1000,
  });

  return (
    <section ref={sectionRef} className="relative w-full py-24">
      <SectionDivider />

      <div className="container-md relative mx-auto max-w-[1200px] px-4 md:px-8">
        <div className="mb-4 text-center" data-animate style={{ opacity: 0 }}>
          <span className="text-sm font-medium uppercase tracking-wider text-white/40">
            技术架构
          </span>
        </div>
        <h2
          className="mb-4 text-center text-3xl font-bold text-white/90 md:text-4xl"
          data-animate style={{ opacity: 0 }}
        >
          现代技术栈驱动
        </h2>
        <p
          className="mx-auto mb-12 max-w-2xl text-center text-lg text-white/50"
          data-animate style={{ opacity: 0 }}
        >
          基于业界领先的开源技术构建，确保性能、可扩展性和开发者体验
        </p>

        <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {techItems.map((tech) => (
            <TechCard key={tech.name} tech={tech} />
          ))}
        </div>

        <div
          className="mt-16 text-center"
          data-animate style={{ opacity: 0 }}
        >
          <p className="mb-4 text-white/30">
            基于 <span className="text-amber-400/80">DeerFlow 2.0</span> 超级智能体框架二次开发
          </p>
          <div
            className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-white/20"
            onMouseEnter={(e) => {
              animate(e.currentTarget, {
                scale: [1, 1.05],
                borderColor: "rgba(16,185,129,0.3)",
                duration: 400,
                ease: "spring(1, 0.5, 10, 0)",
              });
            }}
            onMouseLeave={(e) => {
              animate(e.currentTarget, {
                scale: [1.05, 1],
                borderColor: "rgba(255,255,255,0.05)",
                duration: 500,
                ease: "spring(1, 0.4, 12, 0)",
              });
            }}
          >
            <span className="size-2 rounded-full bg-emerald-500/60 animate-pulse" />
            开源项目 · 本地部署 · 数据自主可控
          </div>
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
          background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.3), transparent)",
        }}
      />
    </div>
  );
}
