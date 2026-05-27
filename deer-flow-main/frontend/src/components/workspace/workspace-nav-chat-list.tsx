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
          >
            <Link className="text-muted-foreground" href="/workspace/novel" prefetch={false}>
              <BookOpenIcon />
              <span>{t.sidebar.novel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/novel") && pathname.includes("/author-control")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/novel" prefetch={false}>
              <ClipboardCheckIcon />
              <span>作者控制台</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/novel/inspiration"}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/novel/inspiration" prefetch={false}>
              <Sparkles />
              <span>灵感模式</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/novel/book-import"}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/novel/book-import" prefetch={false}>
              <Upload />
              <span>拆书导入</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/images")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/images" prefetch={false}>
              <ImageIcon />
              <span>图片生成</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/tts-studio")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/tts-studio" prefetch={false}>
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
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild>
            <Link className="text-muted-foreground" href="/workspace/chats" prefetch={false}>
              <MessagesSquare />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/agents" prefetch={false}>
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
