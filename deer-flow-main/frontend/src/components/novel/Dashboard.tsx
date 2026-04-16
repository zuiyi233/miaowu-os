'use client';

import { useDashboardStatsQuery } from '@/core/novel/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, Users, FileText, PenTool } from 'lucide-react';

export function NovelDashboard() {
  const { data: stats } = useDashboardStatsQuery();

  const statCards = [
    {
      title: 'Total Words',
      value: stats?.totalWordCount?.toLocaleString() || '0',
      icon: <PenTool className="h-5 w-5" />,
      description: 'Total characters written',
    },
    {
      title: 'Total Chapters',
      value: stats?.totalChapters?.toString() || '0',
      icon: <FileText className="h-5 w-5" />,
      description: 'Chapters created',
    },
    {
      title: 'Total Entities',
      value: stats?.totalEntities?.toString() || '0',
      icon: <Users className="h-5 w-5" />,
      description: 'Characters, settings, factions, items',
    },
    {
      title: 'Total Novels',
      value: stats?.novelCount?.toString() || '0',
      icon: <BookOpen className="h-5 w-5" />,
      description: 'Novel projects',
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-8">
        <h1 className="text-3xl font-bold tracking-tight mb-8">Novel Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                {stat.icon}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
