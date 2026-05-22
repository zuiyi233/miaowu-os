"use client";

import { ChevronRightIcon, BookOpen, PenTool, Sparkles } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WordRotate } from "@/components/ui/word-rotate";
import { useHeroAnimation, useMagneticHover, useFloatAnimation } from "@/lib/anime";
import { cn } from "@/lib/utils";
import "@/components/ui/text-effects.css";

function HeroDecorations() {
  return (
    <>
      <div
        className="pointer-events-none absolute top-1/4 left-[10%] size-64 rounded-full opacity-20"
        style={{
          background: "radial-gradient(circle, rgba(245,158,11,0.3) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div
        className="pointer-events-none absolute right-[15%] bottom-1/3 size-48 rounded-full opacity-15"
        style={{
          background: "radial-gradient(circle, rgba(6,182,212,0.3) 0%, transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <div
        className="pointer-events-none absolute top-1/3 right-[8%] size-32 rounded-full opacity-10"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <svg
        className="pointer-events-none absolute top-20 left-0 h-full w-full opacity-[0.04]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="hero-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hero-grid)" />
      </svg>
    </>
  );
}

function FloatingOrbs() {
  const orbsRef = useFloatAnimation("[data-orb]");

  return (
    <div ref={orbsRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        data-orb
        className="absolute top-[20%] left-[5%] size-2 rounded-full bg-amber-400/40"
        style={{ boxShadow: "0 0 12px rgba(245,158,11,0.3)" }}
      />
      <div
        data-orb
        className="absolute top-[60%] right-[8%] size-1.5 rounded-full bg-cyan-400/30"
        style={{ boxShadow: "0 0 10px rgba(6,182,212,0.3)" }}
      />
      <div
        data-orb
        className="absolute top-[40%] right-[25%] size-1 rounded-full bg-purple-400/30"
        style={{ boxShadow: "0 0 8px rgba(168,85,247,0.3)" }}
      />
      <div
        data-orb
        className="absolute bottom-[30%] left-[20%] size-1.5 rounded-full bg-amber-300/25"
        style={{ boxShadow: "0 0 10px rgba(245,158,11,0.2)" }}
      />
      <div
        data-orb
        className="absolute top-[75%] left-[40%] size-1 rounded-full bg-rose-400/20"
        style={{ boxShadow: "0 0 8px rgba(244,63,94,0.2)" }}
      />
    </div>
  );
}

function KineticTagline({ text }: { text: string }) {
  const words = text.split(" ");

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-2">
      {words.map((word, i) => (
        <span key={i} className="kinetic-word">
          {word}
        </span>
      ))}
    </span>
  );
}

export function Hero({ className }: { className?: string }) {
  const heroRef = useHeroAnimation();
  const magneticRef = useMagneticHover("[data-magnetic]", 0.25);

  return (
    <div
      ref={heroRef}
      className={cn(
        "relative flex size-full flex-col items-center justify-center overflow-hidden",
        className,
      )}
    >
      <HeroDecorations />
      <FloatingOrbs />

      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-center px-4">
        <div
          data-hero-badge
          className="mb-6 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-300 backdrop-blur-sm"
          style={{ opacity: 0 }}
        >
          <Sparkles className="size-4" />
          <span>AI 驱动的小说创作与阅读平台</span>
        </div>

        <h1
          data-hero-title
          className="flex flex-wrap items-center justify-center gap-3 text-4xl font-extrabold md:text-6xl lg:text-7xl"
          style={{ opacity: 0 }}
        >
          <WordRotate
            words={["创作", "阅读", "探索", "发现", "沉浸", "体验"]}
          />
          <span className="gradient-text-sunset">
            无限精彩故事
          </span>
        </h1>

        <p
          data-hero-desc
          className="text-muted-foreground mt-8 max-w-2xl scale-105 text-center text-xl text-shadow-sm"
          style={{ opacity: 0 }}
        >
          <KineticTagline text="MiaoWu Novel 基于 DeerFlow 超级智能体框架，提供专业级 AI 辅助小说创作与沉浸式阅读体验。" />
        </p>

        <div
          ref={magneticRef}
          className="mt-8 flex gap-4"
          style={{ opacity: 0 }}
          data-hero-btn
        >
          <Link href="/workspace/novel" data-magnetic>
            <Button className="size-lg bg-amber-500 hover:bg-amber-600 group relative overflow-hidden" size="lg">
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-400/0 via-white/20 to-amber-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <BookOpen className="size-4" />
              <span className="text-md">开始阅读</span>
              <ChevronRightIcon className="size-4" />
            </Button>
          </Link>
          <Link href="/workspace/novel" data-magnetic>
            <Button variant="outline" className="size-lg border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-amber-500/30 group" size="lg">
              <PenTool className="size-4" />
              <span className="text-md">AI 创作</span>
            </Button>
          </Link>
        </div>

        <div className="mt-16 flex items-center gap-6 text-sm text-white/20" style={{ opacity: 0 }} data-hero-btn>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
            <span>多模型支持</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-400/60 animate-pulse" />
            <span>本地部署</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-cyan-400/60 animate-pulse" />
            <span>开源免费</span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050508] to-transparent" />
    </div>
  );
}
