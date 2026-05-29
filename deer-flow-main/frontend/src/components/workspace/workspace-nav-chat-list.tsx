"use client";

import {
  BookOpenIcon,
  BotIcon,
  ClipboardCheckIcon,
  ImageIcon,
  MessagesSquare,
  Music2Icon,
  Sparkles,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <SidebarGroup className="pt-1">
      <div className="text-muted-foreground/70 px-2 pb-1 text-[11px] font-medium tracking-wide uppercase group-data-[collapsible=icon]:hidden">
        创作工作台
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/novel") && !pathname.includes("/inspiration") && !pathname.includes("/book-import")}
            asChild
            tooltip="小说工作室"
          >
            <Link className="text-muted-foreground" href="/workspace/novel">
              <BookOpenIcon />
              <span>{t.sidebar.novel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/novel") && pathname.includes("/author-control")}
            asChild
            tooltip="作者控制台"
          >
            <Link className="text-muted-foreground" href="/workspace/novel">
              <ClipboardCheckIcon />
              <span>作者控制台</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/novel/inspiration"}
            asChild
            tooltip="灵感模式"
          >
            <Link className="text-muted-foreground" href="/workspace/novel/inspiration">
              <Sparkles />
              <span>灵感模式</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/novel/book-import"}
            asChild
            tooltip="拆书导入"
          >
            <Link className="text-muted-foreground" href="/workspace/novel/book-import">
              <Upload />
              <span>拆书导入</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/images")}
            asChild
            tooltip="图片生成"
          >
            <Link className="text-muted-foreground" href="/workspace/images">
              <ImageIcon />
              <span>图片生成</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/tts-studio")}
            asChild
            tooltip="音频工作站"
          >
            <Link className="text-muted-foreground" href="/workspace/tts-studio">
              <Music2Icon />
              <span>音频工作站</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <div className="text-muted-foreground/70 px-2 pt-4 pb-1 text-[11px] font-medium tracking-wide uppercase group-data-[collapsible=icon]:hidden">
        通用智能体
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild tooltip={t.sidebar.chats}>
            <Link className="text-muted-foreground" href="/workspace/chats">
              <MessagesSquare />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
            tooltip={t.sidebar.agents}
          >
            <Link className="text-muted-foreground" href="/workspace/agents">
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
