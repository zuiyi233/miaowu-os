"use client";

import { Flame, Eye, Star, BookOpen } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Section } from "../section";

const hotNovels = [
  {
    id: "1",
    title: "星际穿越者",
    author: "星辰大海",
    category: "科幻",
    description: "在遥远的未来，人类终于掌握了星际旅行的技术。主角林远作为一名普通的星际船员，意外发现了一处远古文明的遗迹...",
    views: 128.5,
    rating: 9.2,
    chapters: 256,
    tags: ["星际", "冒险", "热血"],
    color: "from-cyan-600/30 to-blue-600/30",
    borderColor: "border-cyan-500/20",
    hoverBorder: "hover:border-cyan-400/40",
  },
  {
    id: "2",
    title: "修仙归来",
    author: "青云道人",
    category: "玄幻",
    description: "渡劫失败的陈凡意外重生回到少年时代，带着前世的记忆和修为，他誓要弥补所有遗憾，登临巅峰...",
    views: 98.2,
    rating: 9.0,
    chapters: 512,
    tags: ["重生", "修仙", "逆袭"],
    color: "from-purple-600/30 to-indigo-600/30",
    borderColor: "border-purple-500/20",
    hoverBorder: "hover:border-purple-400/40",
  },
  {
    id: "3",
    title: "都市神医",
    author: "白衣天使",
    category: "都市",
    description: "身怀绝世医术的叶天，从深山老林来到繁华都市。凭借一手出神入化的医术，他救治了无数疑难杂症患者...",
    views: 86.7,
    rating: 8.8,
    chapters: 328,
    tags: ["神医", "都市", "爽文"],
    color: "from-emerald-600/30 to-teal-600/30",
    borderColor: "border-emerald-500/20",
    hoverBorder: "hover:border-emerald-400/40",
  },
  {
    id: "4",
    title: "大唐第一才子",
    author: "墨客书生",
    category: "历史",
    description: "现代文学博士李墨穿越到大唐盛世，凭借满腹经纶和超前思维，在诗酒风流的大唐掀起了一场文化风暴...",
    views: 72.3,
    rating: 8.9,
    chapters: 189,
    tags: ["穿越", "历史", "才子"],
    color: "from-amber-600/30 to-orange-600/30",
    borderColor: "border-amber-500/20",
    hoverBorder: "hover:border-amber-400/40",
  },
  {
    id: "5",
    title: "暗夜猎手",
    author: "黑夜行者",
    category: "悬疑",
    description: "一桩离奇的连环杀人案，将刑警队长张峰卷入了一场跨越二十年的惊天阴谋。真相，往往比想象更加残酷...",
    views: 65.1,
    rating: 9.1,
    chapters: 156,
    tags: ["悬疑", "推理", "刑侦"],
    color: "from-slate-600/30 to-gray-600/30",
    borderColor: "border-slate-500/20",
    hoverBorder: "hover:border-slate-400/40",
  },
  {
    id: "6",
    title: "绝世武魂",
    author: "龙战天下",
    category: "玄幻",
    description: "天生废脉的少年秦羽，在一次意外中觉醒了远古武魂。从此，他踏上了一条逆天改命、征战诸天的道路...",
    views: 58.9,
    rating: 8.7,
    chapters: 724,
    tags: ["武魂", "热血", "升级"],
    color: "from-red-600/30 to-rose-600/30",
    borderColor: "border-red-500/20",
    hoverBorder: "hover:border-red-400/40",
  },
];

export function HotSection({ className }: { className?: string }) {
  return (
    <Section
      className={className}
      title={
        <span className="flex items-center gap-3">
          <Flame className="size-8 text-orange-500" />
          热门推荐
        </span>
      }
      subtitle="大家都在读的精彩小说"
    >
      <div className="container-md mt-8 grid grid-cols-1 gap-4 px-4 md:grid-cols-2 md:px-20 lg:grid-cols-3">
        {hotNovels.map((novel, index) => (
          <Link key={novel.id} href={`/workspace/novel/${novel.id}`}>
            <Card
              className={cn(
                "group/card relative h-72 overflow-hidden border bg-white/[0.03] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
                novel.borderColor,
                novel.hoverBorder,
                index < 3 && "ring-1 ring-orange-500/20"
              )}
            >
              <div
                className={cn(
                  "absolute inset-0 z-0 bg-linear-to-br opacity-40 transition-opacity duration-300 group-hover/card:opacity-60",
                  novel.color
                )}
              />
              <CardContent className="relative z-10 flex h-full flex-col justify-between p-5">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Badge variant="secondary" className="border-0 bg-white/10 text-white/80 backdrop-blur-sm">
                      {novel.category}
                    </Badge>
                    {index < 3 && (
                      <Badge className="border-0 bg-orange-500 text-white shadow-lg shadow-orange-500/30">
                        TOP {index + 1}
                      </Badge>
                    )}
                  </div>
                  <h3 className="mb-1 text-xl font-bold text-white transition-colors group-hover/card:text-amber-300">
                    {novel.title}
                  </h3>
                  <p className="mb-2 text-sm text-white/50">{novel.author}</p>
                  <p className="line-clamp-3 text-sm text-white/60">
                    {novel.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {novel.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-xs text-white/50 backdrop-blur-sm"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-white/40">
                  <span className="flex items-center gap-1">
                    <Eye className="size-3.5" />
                    {novel.views}万
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="size-3.5 text-amber-400" />
                    {novel.rating}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="size-3.5" />
                    {novel.chapters}章
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </Section>
  );
}
