"use client";

import {
  BotIcon,
  MessagesSquare,
  BookOpenIcon,
  ChevronDown,
  Users,
  Castle,
  MapPin,
  Gem,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useState } from "react";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { useNovelStore } from "@/core/novel";
import { useNovelQuery } from "@/core/novel/queries";
import { EntitySidebar } from "@/components/novel/sidebar/EntitySidebar";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useParams();
  const novelTitleFromUrl = params?.novelId as string | undefined;
  const { currentNovelTitle } = useNovelStore();
  const activeNovelTitle = novelTitleFromUrl
    ? decodeURIComponent(novelTitleFromUrl)
    : currentNovelTitle || "";
  const [entityExpanded, setEntityExpanded] = useState(false);

  const isNovelPage = pathname.startsWith("/workspace/novel");
  const { data: novel } = useNovelQuery(isNovelPage ? activeNovelTitle : undefined);

  return (
    <SidebarGroup className="pt-1 flex flex-col h-full min-h-0">
      <SidebarMenu className="flex-1 flex flex-col min-h-0">
        <SidebarMenuItem className="shrink-0">
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild>
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
          >
            <Link className="text-muted-foreground" href="/workspace/agents">
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className="flex-1 flex flex-col min-h-0">
          <SidebarMenuButton
            isActive={isNovelPage}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/novel">
              <BookOpenIcon />
              <span>{t.sidebar.novel}</span>
            </Link>
          </SidebarMenuButton>
          {isNovelPage && activeNovelTitle && (
            <div className="mt-1 space-y-1">
              <button
                onClick={() => setEntityExpanded(!entityExpanded)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                    entityExpanded ? "rotate-180" : ""
                  }`}
                />
                <span className="truncate font-medium">{t.novel.entities}</span>
              </button>
              {entityExpanded && (
                <div className="ml-2 pl-2 border-l border-sidebar-border flex flex-col">
                  <div className="mb-1.5 shrink-0">
                    <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                      {t.novel.entities}
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin min-h-0">
                    <EntitySidebar novelTitle={activeNovelTitle} compact />
                  </div>
                </div>
              )}
              {!entityExpanded && (
                <div className="flex flex-col gap-0.5 pl-6">
                  {[
                    { label: t.novel.characters, count: novel?.characters?.length || 0, icon: <Users className="h-3 w-3" /> },
                    { label: t.novel.factions, count: novel?.factions?.length || 0, icon: <Castle className="h-3 w-3" /> },
                    { label: t.novel.settings_entity, count: novel?.settings?.length || 0, icon: <MapPin className="h-3 w-3" /> },
                    { label: t.novel.items, count: novel?.items?.length || 0, icon: <Gem className="h-3 w-3" /> },
                  ].map(({ label, count, icon }) => (
                    <button
                      key={label}
                      onClick={() => setEntityExpanded(true)}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                    >
                      {icon}
                      <span className="truncate">{label}</span>
                      {count > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-accent px-1 text-[10px] font-medium tabular-nums">
                          {count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
