import React from "react";
import { useModalStore } from "@/stores/useModalStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Drawer } from "vaul"; // 从 vaul 导入 Drawer

/**
 * 全局模态渲染器组件
 * 遵循单一职责原则，专注于根据状态渲染模态框
 *
 * 设计原则应用：
 * - KISS: 简单的条件渲染逻辑，易于理解和维护
 * - DRY: 统一的模态框渲染方式，避免重复的渲染逻辑
 * - SOLID:
 *   - SRP: 专注于模态框的渲染逻辑
 *   - OCP: 支持扩展新的模态框类型而无需修改现有代码
 *   - DIP: 依赖抽象的 ModalConfig 接口而非具体实现
 */
export const GlobalModalRenderer: React.FC = () => {
  const { config, close } = useModalStore();

  // 如果没有配置，不渲染任何内容
  if (!config) {
    return null;
  }

  // 解构出 title 和 description
  const { component: Component, props, type, title, description } = config;
  const isOpen = !!config;

  // 处理模态框关闭事件
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close();
    }
  };

  // 渲染组件内容，传递 onClose 回调和其他 props
  const content = <Component {...(props as any)} onClose={close} />;

  // 根据类型渲染不同的模态框
  if (type === "drawer") {
    return (
      <Drawer.Root open={isOpen} onOpenChange={handleOpenChange}>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="bg-background flex flex-col rounded-t-[10px] h-[96%] mt-24 fixed bottom-0 left-0 right-0">
          {/* 添加一个专门的把手区域，提升体验 */}
          <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-muted mb-2 mt-4" />
          
          {/* 关键修复：添加 overflow-y-auto 和 flex-1 确保内容区域可滚动 */}
          <div className="flex-1 overflow-y-auto px-4 pb-8">
             {/* 限制最大宽度，防止在大屏幕上太宽 */}
             <div className="max-w-3xl mx-auto">
                {content}
             </div>
          </div>
        </Drawer.Content>
      </Drawer.Root>
    );
  }

  // 默认为 Dialog，使用标准结构
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        {/* ✅ 修复：确保 DialogHeader 和 DialogTitle 始终存在 */}
        <DialogHeader>
          <DialogTitle className={!title ? "sr-only" : ""}>
            {title || "对话框"} {/* 提供一个后备标题 */}
          </DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
};
