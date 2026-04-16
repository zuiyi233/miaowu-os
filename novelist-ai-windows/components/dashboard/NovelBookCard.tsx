import React, { useRef } from "react";
import {
  Book,
  Clock,
  ChevronRight,
  MoreVertical,
  ImagePlus,
  Trash2,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/utils";
import { compressImage } from "../../lib/utils/image";
import { toast } from "sonner";
import { databaseService } from "../../lib/storage/db";
import { useQueryClient } from "@tanstack/react-query";

interface NovelBookCardProps {
  id: string;
  title: string;
  outline?: string;
  coverImage?: string;
  stats: {
    volumes: number;
    chapters: number;
    words: number;
  };
  onClick: () => void;
  index: number;
}

export const NovelBookCard: React.FC<NovelBookCardProps> = ({
  id,
  title,
  outline,
  coverImage,
  stats,
  onClick,
  index,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // 处理封面上传
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading("正在处理封面图片...");

    try {
      // ✅ 使用更新后的 compressImage，限制宽高为 600x800，质量 0.7
      // 这将强制重新编码所有图片，即使原图很小
      const base64 = await compressImage(file, 600, 0.7, 800);

      // 直接传递 id，由 DatabaseService 内部判断类型
      await databaseService.updateNovel(id, { coverImage: base64 });

      // 强制刷新列表以显示新封面
      await queryClient.invalidateQueries({ queryKey: ["novelList"] });
      toast.success("封面更新成功", { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error("封面上传失败", {
        id: toastId,
        description: "图片可能太大或格式不支持",
      });
    } finally {
      // 重置 input，允许重复上传同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveCover = async () => {
    // 直接传递 id，由 DatabaseService 内部判断类型
    await databaseService.updateNovel(id, { coverImage: undefined });
    await queryClient.invalidateQueries({ queryKey: ["novelList"] });
    toast.success("已恢复默认封面");
  };

  const getCoverColor = (str: string) => {
    const colors = [
      "from-amber-700 to-amber-900",
      "from-slate-700 to-slate-900",
      "from-emerald-800 to-emerald-950",
      "from-rose-900 to-red-950",
      "from-indigo-800 to-indigo-950",
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleCoverUpload}
      />

      <div
        className="group relative flex flex-col bg-card border border-border/60 rounded-xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-primary/20 hover:-translate-y-1 cursor-pointer h-full w-full max-w-md mx-auto"
        style={{ animationDelay: `${index * 50}ms` }}
        onClick={onClick}
      >
        {/* 上半部分：封面区域 */}
        <div
          className={cn(
            "h-40 relative overflow-hidden transition-all duration-500",
            coverImage
              ? "bg-black"
              : `bg-gradient-to-br ${getCoverColor(title)}`
          )}
        >
          {coverImage ? (
            <img
              src={coverImage}
              alt={title}
              className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700 ease-out"
            />
          ) : (
            <>
              <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/leather.png')] mix-blend-overlay" />
              <div className="absolute left-0 top-0 bottom-0 w-3 bg-white/10 backdrop-blur-sm shadow-2xl" />

              <div className="relative z-10 p-6 h-full flex flex-col justify-between text-white">
                <Book className="w-8 h-8 opacity-80" />
                <h3 className="text-2xl font-bold font-['Lora'] text-white line-clamp-2 tracking-tight shadow-black/50 drop-shadow-sm mt-auto">
                  {title}
                </h3>
              </div>
            </>
          )}

          {coverImage && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-4">
              <h3 className="text-xl font-bold font-['Lora'] text-white line-clamp-2 shadow-black/50 drop-shadow-sm">
                {title}
              </h3>
            </div>
          )}

          <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
            <Badge
              variant="secondary"
              className="bg-black/40 text-white hover:bg-black/60 backdrop-blur-md border-none text-xs font-normal"
            >
              {stats.chapters} 章节
            </Badge>
          </div>
        </div>

        {/* 下半部分：信息与操作 */}
        <div className="p-4 flex-1 flex flex-col bg-card/50 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed mb-4 h-10">
            {outline || "暂无大纲描述..."}
          </p>

          <div className="mt-auto flex items-center justify-between pt-4 border-t border-dashed border-border/50">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {(stats.words / 10000).toFixed(1)}万字
            </span>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-background focus:ring-0"
                    // ✅ 修复 1: 阻止打开菜单时的冒泡（这部分原代码已有，保留）
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>

                {/* ✅ 修复 2 (核心): 在 Content 层阻止 React 事件冒泡 */}
                {/* 即使是 Portal，React 事件依然会沿着组件树向上冒泡到 Card 的 onClick */}
                <DropdownMenuContent
                  align="end"
                  className="w-40"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault(); // 防止菜单在文件选择前关闭
                      fileInputRef.current?.click();
                    }}
                  >
                    <ImagePlus className="w-4 h-4 mr-2" />
                    {coverImage ? "更换封面" : "上传封面"}
                  </DropdownMenuItem>

                  {coverImage && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        handleRemoveCover();
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      移除封面
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      // 确保其他菜单项也不会触发卡片跳转
                      // 这里不需要 e.stopPropagation() 因为已经在 Content 层处理了
                      // 但为了保险，导出等操作也应该处理
                      // 模拟导出操作
                      toast.info("导出功能开发中...");
                    }}
                  >
                    导出作品
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 px-2 hover:bg-primary/10 hover:text-primary group-hover:translate-x-1 transition-all"
              >
                进入 <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
