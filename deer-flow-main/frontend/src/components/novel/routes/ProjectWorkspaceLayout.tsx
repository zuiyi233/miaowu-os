'use client';

import { BookOpen, Building2, Compass, Flag, GitBranch, PencilLine, Settings, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type MatchMode = 'exact' | 'prefix';

interface NavItem {
  title: string;
  href: string;
  icon: ReactNode;
  matchMode?: MatchMode;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface ProjectWorkspaceLayoutProps {
  novelId: string;
  children: ReactNode;
}

function isActive(pathname: string, href: string, matchMode: MatchMode = 'exact') {
  if (matchMode === 'prefix') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

export function ProjectWorkspaceLayout({ novelId, children }: ProjectWorkspaceLayoutProps) {
  const pathname = usePathname();
  const basePath = `/workspace/novel/${encodeURIComponent(novelId)}`;

  const navGroups: NavGroup[] = [
    {
      title: '核心内容',
      items: [
        { title: '章节管理', href: `${basePath}/chapters`, icon: <BookOpen className="h-4 w-4" />, matchMode: 'prefix' },
        { title: '世界观', href: `${basePath}/world-setting`, icon: <Compass className="h-4 w-4" /> },
        { title: '角色', href: `${basePath}/characters`, icon: <Users className="h-4 w-4" /> },
        { title: '大纲', href: `${basePath}/outline`, icon: <PencilLine className="h-4 w-4" /> },
      ],
    },
    {
      title: '关系与组织',
      items: [
        { title: '关系概览', href: `${basePath}/relationships`, icon: <GitBranch className="h-4 w-4" /> },
        { title: '关系图谱', href: `${basePath}/relationships/graph`, icon: <GitBranch className="h-4 w-4" /> },
        { title: '组织', href: `${basePath}/organizations`, icon: <Building2 className="h-4 w-4" /> },
        { title: '职业体系', href: `${basePath}/careers`, icon: <Users className="h-4 w-4" /> },
      ],
    },
    {
      title: '增强能力',
      items: [
        { title: '伏笔', href: `${basePath}/foreshadows`, icon: <Flag className="h-4 w-4" /> },
        { title: '写作风格', href: `${basePath}/writing-styles`, icon: <Sparkles className="h-4 w-4" /> },
        { title: 'Prompt 工坊', href: `${basePath}/prompt-workshop`, icon: <Sparkles className="h-4 w-4" /> },
        { title: '设置', href: `${basePath}/settings`, icon: <Settings className="h-4 w-4" /> },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="border-b bg-muted/10 md:w-72 md:border-b-0 md:border-r">
        <ScrollArea className="max-h-64 md:h-full md:max-h-none">
          <div className="space-y-5 p-3 md:p-4">
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">小说工作区</p>
              <p className="truncate text-sm font-medium" title={novelId}>{novelId}</p>
            </div>

            {navGroups.map((group) => (
              <section key={group.title} className="space-y-1.5">
                <h3 className="px-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href, item.matchMode);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {item.icon}
                        <span>{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">{children}</main>
    </div>
  );
}
