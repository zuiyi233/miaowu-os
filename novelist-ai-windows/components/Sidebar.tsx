import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../stores/useUiStore";
import { useModalStore } from "../stores/useModalStore";
import {
  useNovelDataSelector,
  useReorderChaptersMutation,
} from "../lib/react-query/db-queries";
import {
  Book,
  ChevronDown,
  ChevronRight,
  Users,
  Settings,
  PlusCircle,
  Plus,
  FolderOpen,
  Folder,
  MapPin,
  Gem,
  Shield,
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EntityCard } from "./common/EntityCard";
import { NovelCreationDialog } from "./NovelCreationDialog";
import { useVolumeCreationModal } from "../hooks/useCreationModal";
import { useChapterCreationModal } from "../hooks/useCreationModal";
import { NovelSelector } from "./NovelSelector";
import { CharacterList } from "./sidebar/CharacterList";
import { SettingList } from "./sidebar/SettingList";
import { FactionList } from "./sidebar/FactionList";
import { ItemList } from "./sidebar/ItemList";
import { SettingsDialog } from "./SettingsDialog";
import { cn } from "../lib/utils";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";

const SidebarSectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
}> = ({ icon, title }) => (
  <h3 className="flex items-center gap-2 px-2 py-2 text-sm font-semibold text-muted-foreground">
    {icon}
    <span>{title}</span>
  </h3>
);

// Create a new component for the sortable item
const SortableChapter: React.FC<{ chapter: any }> = ({ chapter }) => {
  const { activeChapterId, setActiveChapterId } = useUiStore();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Button
        variant={activeChapterId === chapter.id ? "secondary" : "ghost"}
        onClick={() => setActiveChapterId(chapter.id)}
        className="w-full justify-start text-base h-auto py-2 px-4"
      >
        <span className="truncate flex-1 text-left">{chapter.title}</span>
        <span
          className="w-4 h-4 ml-2 cursor-grab active:cursor-grabbing text-muted-foreground"
          {...listeners}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 9h14" />
            <path d="M5 15h14" />
            <path d="M5 3l2 2-2 2" />
            <path d="M19 3l-2 2 2 2" />
            <path d="M5 19l2-2-2-2" />
            <path d="M19 19l-2-2 2-2" />
          </svg>
        </span>
      </Button>
    </div>
  );
};

// 虚拟化章节列表组件 - 纯渲染组件，不包含DndContext
const VirtualizedChapterList: React.FC<{
  chapters: any[];
}> = ({ chapters }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: chapters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // 估算每个章节项的高度
    overscan: 5, // 在视口外额外渲染5个项
  });

  return (
    <div ref={parentRef} className="max-h-[400px] overflow-y-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const chapter = chapters[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SortableChapter chapter={chapter} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { activeChapterId, setActiveChapterId } = useUiStore();
  const { open } = useModalStore();
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(
    new Set(["vol1"])
  );

  // ✅ 使用新的 useCreationModal Hooks，简化对话框逻辑
  const openCreateVolume = useVolumeCreationModal();
  const openCreateChapter = useChapterCreationModal();

  // ✅ 使用 useNovelDataSelector 优化性能，只订阅卷和章节数据
  const { data: volumesAndChapters } = useNovelDataSelector((novel) => ({
    volumes: novel?.volumes || [],
    // ✅ 确保 chapters 是一个扁平化的数组，包含所有章节
    chapters: novel?.chapters || [],
  }));

  const reorderChaptersMutation = useReorderChaptersMutation();

  // 从查询结果中解构数据
  const { volumes = [], chapters = [] } = volumesAndChapters || {};

  // ✅ 添加这个 useEffect 来自动选择章节
  useEffect(() => {
    // 如果章节列表加载完成，但没有章节被选中
    if (
      chapters.length > 0 &&
      !chapters.find((ch) => ch.id === activeChapterId)
    ) {
      // 自动选中第一个章节
      setActiveChapterId(chapters[0].id);
    }
  }, [chapters, activeChapterId, setActiveChapterId]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = chapters.findIndex((c: any) => c.id === active.id);
      const newIndex = chapters.findIndex((c: any) => c.id === over.id);
      reorderChaptersMutation.mutate({ oldIndex, newIndex });
    }
  };

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(volumeId)) {
        newSet.delete(volumeId);
      } else {
        newSet.add(volumeId);
      }
      return newSet;
    });
  };

  const handleOpenSettings = () => {
    open({
      type: "dialog",
      title: t("settings_dialog.title"),
      description: t("settings_dialog.api"),
      component: SettingsDialog,
      props: {},
    });
  };

  const getChapterById = (chapterId: string) => {
    return chapters.find((ch) => ch.id === chapterId);
  };

  if (!volumes || !chapters) {
    return (
      <div className="h-full flex flex-col bg-card border-r">
        <div className="p-4 border-b flex items-center gap-3">
          <Book className="w-6 h-6 text-primary flex-shrink-0" />
          <h2 className="text-xl font-bold truncate">{t("common.loading")}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">{t("sidebar.loadingData")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card border-r">
      <div className="p-4 border-b flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Book className="w-6 h-6 text-primary flex-shrink-0" />
          <h2 className="text-xl font-bold truncate">Mì Jìng</h2>
        </div>

        <NovelSelector />
      </div>
      <ScrollArea className="flex-1 p-2">
        <Card className="mb-4">
          <CardContent className="p-2">
            <nav className="grid items-start gap-1">
              <SidebarSectionHeader
                icon={<ChevronDown className="w-4 h-4" />}
                title={t("sidebar.editor")}
              />

              {/* ✅ 将 DndContext 提升到所有卷的外部，避免无限渲染循环 */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={chapters.map((c: any) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {/* 显示卷和章节的层次结构 */}
                  {volumes.map((volume) => (
                    <div key={volume.id} className="mt-2">
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-base h-auto py-2 px-4 font-semibold"
                        onClick={() => toggleVolume(volume.id)}
                      >
                        {expandedVolumes.has(volume.id) ? (
                          <ChevronDown className="w-4 h-4 mr-2" />
                        ) : (
                          <ChevronRight className="w-4 h-4 mr-2" />
                        )}
                        {expandedVolumes.has(volume.id) ? (
                          <FolderOpen className="w-4 h-4 mr-2" />
                        ) : (
                          <Folder className="w-4 h-4 mr-2" />
                        )}
                        <span className="flex-1 text-left">{volume.title}</span>
                      </Button>

                      {expandedVolumes.has(volume.id) && (
                        <div className="ml-4 mt-1">
                          {/* ✅ VirtualizedChapterList 现在是纯渲染组件，不包含 DndContext */}
                          <VirtualizedChapterList chapters={volume.chapters || []} />
                        </div>
                      )}
                    </div>
                  ))}
                </SortableContext>
              </DndContext>

              {/* 添加新卷按钮 */}
              <div className="mt-4 px-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openCreateVolume()}
                >
                  <Folder className="w-4 h-4 mr-2" />
                  {t("volume.newVolume")}
                </Button>
              </div>

              {/* 添加新章节按钮 */}
              <div className="mt-2 px-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => openCreateChapter()}
                >
                  <PlusCircle className="w-4 h-4 mr-2" />
                  {t("chapter.newChapter")}
                </Button>
              </div>
            </nav>
          </CardContent>
        </Card>
        <Card className="mb-4">
          <CardContent className="p-2">
            <SidebarSectionHeader
              icon={<Users className="w-4 h-4" />}
              title={t("sidebar.aiAssistant")}
            />
            <Tabs defaultValue="characters" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="characters">
                  <Users className="w-4 h-4 mr-1" />
                  {t("entity.character")}
                </TabsTrigger>
                <TabsTrigger value="settings">
                  <MapPin className="w-4 h-4 mr-1" />
                  {t("entity.setting")}
                </TabsTrigger>
                <TabsTrigger value="items">
                  <Gem className="w-4 h-4 mr-1" />
                  {t("entity.item")}
                </TabsTrigger>
                <TabsTrigger value="factions">
                  <Shield className="w-4 h-4 mr-1" />
                  {t("entity.faction")}
                </TabsTrigger>
              </TabsList>

              {/* ✅ 使用子组件，每个组件只订阅自己需要的数据 */}
              <TabsContent value="characters" className="mt-2">
                <CharacterList />
              </TabsContent>

              <TabsContent value="settings" className="mt-2">
                <SettingList />
              </TabsContent>

              <TabsContent value="items" className="mt-2">
                <ItemList />
              </TabsContent>

              <TabsContent value="factions" className="mt-2">
                <FactionList />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <Card className="mb-4">
          <CardContent className="p-2">
            <div onClick={handleOpenSettings} className="cursor-pointer">
              <SidebarSectionHeader
                icon={<Settings className="w-4 h-4" />}
                title={t("common.settings")}
              />
              <div className="px-4 py-2 text-sm text-muted-foreground italic hover:bg-accent rounded-md">
                {t("settings_dialog.api")}
              </div>
            </div>
          </CardContent>
        </Card>
      </ScrollArea>
      <div className="p-4 border-t text-xs text-center text-muted-foreground">
        {t("sidebar.footerBrand")}
      </div>
    </div>
  );
};
