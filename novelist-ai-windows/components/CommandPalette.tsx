import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { useNovelQuery } from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";
import { File, User } from "lucide-react";
import { useDebounce } from "../hooks/useDebounce";

/**
 * 命令面板组件
 * 使用React Query获取数据，useUiStore管理UI状态
 * 遵循单一职责原则，仅负责命令面板UI渲染
 * 增强支持全文搜索功能
 */
export const CommandPalette = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  
  const { data: novel } = useNovelQuery();
  const { setActiveChapterId } = useUiStore();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // 基于 debouncedQuery 进行搜索
  const searchResults = useMemo(() => {
    if (!novel || !debouncedQuery.trim()) {
      return { chapters: [], characters: [] };
    }

    const lowerQuery = debouncedQuery.toLowerCase();

    // 搜索章节 (标题 或 内容)
    const matchedChapters = (novel.chapters || [])
      .filter(
        (ch) =>
          ch.title.toLowerCase().includes(lowerQuery) ||
          // 限制内容搜索长度，避免卡顿，且仅在 query 长度 > 1 时搜索内容
          (lowerQuery.length > 1 &&
            ch.content?.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 5); // 限制结果数量

    // 搜索角色
    const matchedCharacters = (novel.characters || [])
      .filter((c) => c.name.toLowerCase().includes(lowerQuery))
      .slice(0, 3);

    return { chapters: matchedChapters, characters: matchedCharacters };
  }, [debouncedQuery, novel]);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t("commandPalette.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
        
        {/* 渲染章节结果 */}
        {searchResults.chapters.length > 0 && (
          <CommandGroup heading={t("commandPalette.groups.chapters")}>
            {searchResults.chapters.map((chapter) => (
              <CommandItem
                key={chapter.id}
                onSelect={() => runCommand(() => setActiveChapterId(chapter.id))}
              >
                <File className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                    <span>{chapter.title}</span>
                    {/* 如果是内容匹配，显示摘要 */}
                    {chapter.content?.toLowerCase().includes(debouncedQuery.toLowerCase()) && debouncedQuery.length > 1 && (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                            ...{getSnippet(chapter.content, debouncedQuery)}...
                        </span>
                    )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        
        {/* 渲染角色结果 */}
        {searchResults.characters.length > 0 && (
          <CommandGroup heading={t("commandPalette.groups.characters")}>
            {searchResults.characters.map((char) => (
              <CommandItem
                key={char.id}
                onSelect={() =>
                  runCommand(() => {
                    /* Open character editor */
                  })
                }
              >
                <User className="mr-2 h-4 w-4" />
                <span>{char.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};

// 辅助函数：提取匹配文本片段
function getSnippet(content: string, query: string): string {
  // 移除 HTML 标签并清理多余空白
  const plainText = content
    .replace(/<[^>]+>/g, ' ') // 移除 HTML 标签，替换为空格
    .replace(/\s+/g, ' ') // 合并多个空白字符
    .trim();
  
  const index = plainText.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return "";
  
  // 计算上下文范围，确保不会超出字符串边界
  const start = Math.max(0, index - 15);
  const end = Math.min(plainText.length, index + query.length + 15);
  
  let snippet = plainText.substring(start, end);
  
  // 如果不是从开头截取，添加省略号
  if (start > 0) {
    snippet = "..." + snippet;
  }
  
  // 如果不是到结尾截取，添加省略号
  if (end < plainText.length) {
    snippet = snippet + "...";
  }
  
  return snippet;
}
