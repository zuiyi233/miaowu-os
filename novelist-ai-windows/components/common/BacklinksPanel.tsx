import React from "react";
import { useEntityBacklinks } from "../../lib/react-query/graph.queries";
import { 
  BookOpen, 
  User, 
  MapPin, 
  Shield, 
  Gem, 
  ArrowRight, 
  Link as LinkIcon
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { useUiStore } from "../../stores/useUiStore";
import { useModalStore } from "../../stores/useModalStore";
import { useNovelDataSelector } from "../../lib/react-query/db-queries";
// 导入详情组件以支持跳转
import { CharacterDetail } from "../CharacterDetail";
import { SettingDetail } from "../SettingDetail";
import { FactionDetail } from "../FactionDetail";
import { ItemDetail } from "../ItemDetail";

interface BacklinksPanelProps {
  entityId: string;
  currentType: "character" | "setting" | "faction" | "item";
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({ entityId, currentType }) => {
  const { data: backlinks = [] } = useEntityBacklinks(entityId);
  const { setActiveChapterId } = useUiStore();
  const { open, close } = useModalStore();
  
  // 获取完整小说数据用于查找实体对象
  const novelData = useNovelDataSelector(n => n);

  if (backlinks.length === 0) {
    return null;
  }

  // 处理点击跳转逻辑
  const handleLinkClick = (link: any) => {
    if (link.sourceType === "chapter") {
      // 如果是章节，切换编辑器并关闭当前详情页
      setActiveChapterId(link.sourceId);
      close(); // 关闭抽屉，回到编辑器
    } else {
      // 如果是其他实体，打开新的详情页（替换当前内容）
      // 1. 从 novelData 中找到对应的实体对象
      let entity = null;
      let Component = null;

      if (!novelData.data) return;

      switch (link.sourceType) {
        case "character":
          entity = novelData.data.characters?.find(c => c.id === link.sourceId);
          Component = CharacterDetail;
          break;
        case "setting":
          entity = novelData.data.settings?.find(s => s.id === link.sourceId);
          Component = SettingDetail;
          break;
        case "faction":
          entity = novelData.data.factions?.find(f => f.id === link.sourceId);
          Component = FactionDetail;
          break;
        case "item":
          entity = novelData.data.items?.find(i => i.id === link.sourceId);
          Component = ItemDetail;
          break;
      }

      if (entity && Component) {
        // 打开新的抽屉（实际上是替换当前 Drawer 的内容）
        open({
          type: "drawer",
          component: Component as any,
          props: {
            [link.sourceType]: entity, // 动态 prop 名: character={entity}
            onClose: close, // 传递关闭函数
          },
        });
      }
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "chapter": return <BookOpen className="w-3 h-3" />;
      case "character": return <User className="w-3 h-3" />;
      case "setting": return <MapPin className="w-3 h-3" />;
      case "faction": return <Shield className="w-3 h-3" />;
      case "item": return <Gem className="w-3 h-3" />;
      default: return <LinkIcon className="w-3 h-3" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "chapter": return "章节";
      case "character": return "角色";
      case "setting": return "场景";
      case "faction": return "势力";
      case "item": return "物品";
      default: return "关联";
    }
  };

  return (
    <div className="mt-6 pt-6 border-t">
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
        <LinkIcon className="w-4 h-4" />
        提及此{getTypeLabel(currentType)}的内容 ({backlinks.length})
      </h4>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {backlinks.map((link) => (
          <div
            key={`${link.sourceType}-${link.sourceId}`}
            onClick={() => handleLinkClick(link)}
            className="flex items-center gap-2 p-2 rounded-md border bg-card hover:bg-accent cursor-pointer transition-colors group"
          >
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center shrink-0
              ${link.sourceType === 'chapter' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}
            `}>
              {getIcon(link.sourceType)}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                {link.sourceTitle}
              </div>
              <div className="text-xs text-muted-foreground">
                {getTypeLabel(link.sourceType)}
              </div>
            </div>

            <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </div>
    </div>
  );
};