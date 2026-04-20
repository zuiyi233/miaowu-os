"use client";

import { Library, BookOpen, PenTool, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "../section";

const bookshelfNovels = [
  {
    id: "shelf-1",
    title: "我目前在读",
    description: "继续阅读你正在追的小说",
    icon: BookOpen,
    color: "from-amber-500 to-orange-500",
    bgColor: "bg-amber-500/[0.08]",
    borderColor: "border-amber-500/15",
    hoverBorder: "hover:border-amber-400/30",
    shadowColor: "shadow-amber-500/10",
    href: "/workspace/novel",
  },
  {
    id: "shelf-2",
    title: "我的收藏",
    description: "管理你收藏的小说列表",
    icon: Library,
    color: "from-cyan-500 to-blue-500",
    bgColor: "bg-cyan-500/[0.08]",
    borderColor: "border-cyan-500/15",
    hoverBorder: "hover:border-cyan-400/30",
    shadowColor: "shadow-cyan-500/10",
    href: "/workspace/novel",
  },
  {
    id: "shelf-3",
    title: "AI 创作",
    description: "用 AI 辅助创作你的故事",
    icon: PenTool,
    color: "from-emerald-500 to-teal-500",
    bgColor: "bg-emerald-500/[0.08]",
    borderColor: "border-emerald-500/15",
    hoverBorder: "hover:border-emerald-400/30",
    shadowColor: "shadow-emerald-500/10",
    href: "/workspace/novel",
  },
];

export function BookshelfSection({ className }: { className?: string }) {
  return (
    <Section
      className={className}
      title="我的书架"
      subtitle="管理你的阅读与创作"
    >
      <div className="container-md mt-8 grid grid-cols-1 gap-4 px-4 md:grid-cols-3 md:px-20">
        {bookshelfNovels.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href}>
              <Card
                className={`group h-full border ${item.borderColor} ${item.bgColor} ${item.hoverBorder} backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${item.shadowColor}`}
              >
                <CardContent className="flex h-full flex-col items-center justify-center gap-4 p-8">
                  <div
                    className={`flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl`}
                  >
                    <Icon className="size-8 text-white" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-white/90 transition-colors group-hover:text-amber-300">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-white/50">
                      {item.description}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-white/40 transition-colors group-hover:text-amber-400"
                  >
                    进入
                    <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
