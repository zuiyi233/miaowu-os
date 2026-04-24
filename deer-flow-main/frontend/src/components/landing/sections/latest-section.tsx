"use client";

import { Clock, BookOpen, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { Section } from "../section";

const latestUpdates = [
  {
    id: "1",
    title: "星际穿越者",
    chapter: "第256章 星际之门",
    author: "星辰大海",
    category: "科幻",
    updateTime: "10分钟前",
    isNew: true,
  },
  {
    id: "2",
    title: "修仙归来",
    chapter: "第512章 渡劫成功",
    author: "青云道人",
    category: "玄幻",
    updateTime: "30分钟前",
    isNew: true,
  },
  {
    id: "3",
    title: "都市神医",
    chapter: "第328章 神医显威",
    author: "白衣天使",
    category: "都市",
    updateTime: "1小时前",
    isNew: false,
  },
  {
    id: "4",
    title: "大唐第一才子",
    chapter: "第189章 诗会夺魁",
    author: "墨客书生",
    category: "历史",
    updateTime: "2小时前",
    isNew: false,
  },
  {
    id: "5",
    title: "暗夜猎手",
    chapter: "第156章 真相大白",
    author: "黑夜行者",
    category: "悬疑",
    updateTime: "3小时前",
    isNew: false,
  },
  {
    id: "6",
    title: "绝世武魂",
    chapter: "第724章 武魂觉醒",
    author: "龙战天下",
    category: "玄幻",
    updateTime: "5小时前",
    isNew: false,
  },
  {
    id: "7",
    title: "魔法学院",
    chapter: "第89章 期末考核",
    author: "魔法少女",
    category: "奇幻",
    updateTime: "6小时前",
    isNew: false,
  },
  {
    id: "8",
    title: "商海沉浮",
    chapter: "第145章 股市风云",
    author: "财经作家",
    category: "职场",
    updateTime: "8小时前",
    isNew: false,
  },
];

export function LatestSection({ className }: { className?: string }) {
  return (
    <Section
      className={cn("relative", className)}
      title={
        <span className="flex items-center gap-3">
          <Clock className="size-7 text-cyan-400" />
          最新更新
        </span>
      }
      subtitle="紧跟最新章节，不错过任何精彩"
    >
      {/* Subtle ambient glow behind the list */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-500/[0.02] via-transparent to-transparent" />

      <div className="container-md relative mt-8 px-4 md:px-20">
        <div className="grid gap-2.5">
          {latestUpdates.map((novel) => (
            <Link key={`${novel.id}-${novel.chapter}`} href={`/workspace/novel/${novel.id}`}>
              <Card className="group border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm transition-all duration-300 hover:border-amber-500/20 hover:bg-white/[0.05] hover:shadow-lg hover:shadow-amber-500/5">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/15 shadow-inner">
                    <BookOpen className="size-5 text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate font-semibold text-white/90 transition-colors group-hover:text-amber-300">
                        {novel.title}
                      </h4>
                      {novel.isNew && (
                        <Badge className="shrink-0 border-0 bg-red-500 px-1.5 text-[10px] text-white shadow-md shadow-red-500/20">
                          NEW
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-white/50">{novel.chapter}</p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-3 sm:flex">
                    <Badge variant="outline" className="border-white/[0.08] text-white/40 bg-white/[0.03]">
                      {novel.category}
                    </Badge>
                    <span className="text-sm text-white/40">{novel.author}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-xs text-white/40">
                    <Clock className="size-3" />
                    <span className="hidden sm:inline">{novel.updateTime}</span>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-white/30 transition-all duration-300 group-hover:text-amber-400 group-hover:translate-x-1" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </Section>
  );
}
