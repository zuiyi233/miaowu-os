"use client";

import {
  Sword,
  Heart,
  Rocket,
  Ghost,
  Crown,
  Building2,
  Wand2,
  Laugh,
  Skull,
  Briefcase,
  BookOpen,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Section } from "../section";

const categories = [
  { id: "xuanhuan", name: "玄幻", icon: Sword, color: "from-purple-500 to-indigo-500", glow: "shadow-purple-500/20" },
  { id: "romance", name: "言情", icon: Heart, color: "from-pink-500 to-rose-500", glow: "shadow-pink-500/20" },
  { id: "scifi", name: "科幻", icon: Rocket, color: "from-cyan-500 to-blue-500", glow: "shadow-cyan-500/20" },
  { id: "mystery", name: "悬疑", icon: Ghost, color: "from-slate-500 to-gray-500", glow: "shadow-slate-500/20" },
  { id: "history", name: "历史", icon: Crown, color: "from-amber-500 to-yellow-500", glow: "shadow-amber-500/20" },
  { id: "urban", name: "都市", icon: Building2, color: "from-emerald-500 to-teal-500", glow: "shadow-emerald-500/20" },
  { id: "fantasy", name: "奇幻", icon: Wand2, color: "from-violet-500 to-purple-500", glow: "shadow-violet-500/20" },
  { id: "comedy", name: "搞笑", icon: Laugh, color: "from-orange-500 to-red-500", glow: "shadow-orange-500/20" },
  { id: "horror", name: "恐怖", icon: Skull, color: "from-red-600 to-red-800", glow: "shadow-red-600/20" },
  { id: "workplace", name: "职场", icon: Briefcase, color: "from-blue-500 to-indigo-500", glow: "shadow-blue-500/20" },
  { id: "all", name: "全部", icon: BookOpen, color: "from-amber-400 to-orange-400", glow: "shadow-amber-400/20" },
  { id: "more", name: "更多", icon: MoreHorizontal, color: "from-zinc-500 to-zinc-600", glow: "shadow-zinc-500/20" },
];

export function CategoriesSection({ className }: { className?: string }) {
  return (
    <Section
      className={className}
      title="小说分类"
      subtitle="探索你感兴趣的精彩故事世界"
    >
      <div className="container-md mt-8 grid grid-cols-3 gap-4 px-4 sm:grid-cols-4 md:grid-cols-6 md:px-20">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <Link
              key={category.id}
              href={`/workspace/novel?category=${category.id}`}
              className={cn(
                "group flex flex-col items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm transition-all duration-300",
                "hover:border-amber-500/30 hover:bg-amber-500/[0.08] hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-1"
              )}
            >
              <div
                className={cn(
                  "flex size-12 items-center justify-center rounded-xl bg-linear-to-br shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl",
                  category.color,
                  category.glow
                )}
              >
                <Icon className="size-6 text-white" />
              </div>
              <span className="text-sm font-medium text-white/80 transition-colors group-hover:text-amber-300">
                {category.name}
              </span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
