import React from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useNovelListQuery } from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";
import { useNovelCreationDialog } from "./NovelCreationDialog";

/**
 * 小说选择器组件
 * 遵循单一职责原则，专注于小说选择和切换功能
 *
 * 设计原则：
 * - KISS: 简洁直观的下拉选择界面
 * - DRY: 复用现有的 Shadcn UI 组件和 NovelCreationDialog
 * - SOLID:
 *   - S: 单一职责，只负责小说选择和切换
 *   - D: 依赖抽象的 useUiStore 和 useNovelListQuery
 */
export function NovelSelector() {
  const { currentNovelTitle, setCurrentNovelTitle } = useUiStore();
  const { data: novels = [], isLoading } = useNovelListQuery();

  // 使用现有的 Hook
  const [_, __, NovelCreationDialog] = useNovelCreationDialog();

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-[200px] justify-between truncate"
            disabled={isLoading}
          >
            <span className="truncate">
              {currentNovelTitle || "选择小说..."}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[200px]">
          <DropdownMenuLabel>我的作品</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {novels.map((novel, index) => (
            <DropdownMenuItem
              key={`${novel.title}-${index}`}
              onClick={() => setCurrentNovelTitle(novel.title)}
              className={cn(
                "cursor-pointer",
                currentNovelTitle === novel.title && "bg-accent"
              )}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  currentNovelTitle === novel.title
                    ? "opacity-100"
                    : "opacity-0"
                )}
              />
              <span className="truncate">{novel.title}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="p-1">
            <NovelCreationDialog
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  创建新小说
                </Button>
              }
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
