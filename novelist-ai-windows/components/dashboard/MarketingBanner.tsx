import React from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Sparkles, Trophy, ArrowRight, X } from "lucide-react";
import { useState } from "react";

export const MarketingBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="relative group animate-in fade-in slide-in-from-top-4 duration-500">
      {/* 装饰性背景光晕 */}
      <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
      
      <Card className="relative bg-gradient-to-r from-indigo-900 via-purple-900 to-pink-900 border-none text-white overflow-hidden">
        {/* 抽象背景纹理 */}
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/40 via-transparent to-transparent" />
        
        <CardContent className="p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/20 hidden sm:block">
              <Trophy className="w-8 h-8 text-yellow-300" />
            </div>
            <div className="space-y-2 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <span className="px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-200 text-xs font-bold border border-yellow-400/30 uppercase tracking-wider">
                  Season 2
                </span>
                <h3 className="text-lg font-bold font-['Plus_Jakarta_Sans']">百万字数挑战赛</h3>
              </div>
              <p className="text-indigo-100 max-w-md text-sm leading-relaxed">
                只要在 11 月完成 10 万字更新，即可解锁 "传奇笔触" 主题皮肤。现在的你，距离目标还差 8.5 万字。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
             <Button className="flex-1 md:flex-none bg-white text-purple-900 hover:bg-indigo-50 font-semibold shadow-lg border-0">
               查看详情 <ArrowRight className="w-4 h-4 ml-2" />
             </Button>
             <Button 
               variant="ghost" 
               size="icon" 
               className="text-white/50 hover:text-white hover:bg-white/10 absolute top-2 right-2 md:relative md:top-auto md:right-auto"
               onClick={() => setIsVisible(false)}
             >
               <X className="w-4 h-4" />
             </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};