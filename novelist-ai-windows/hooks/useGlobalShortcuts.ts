import { useEffect, useCallback } from "react";
import { useModalStore } from "@/stores/useModalStore";
import { useCreationModal } from "@/hooks/useCreationModal";
import { toast } from "sonner";

/**
 * 全局快捷键 Hook
 * 提供应用级别的快捷键功能，提升用户操作效率
 * 
 * 设计原则：
 * - KISS原则：简洁直观的快捷键映射
 * - 用户体验：符合用户习惯的快捷键组合
 * - 功能性：覆盖核心操作的快捷访问
 */
export const useGlobalShortcuts = () => {
  const { openModal } = useModalStore();
  const { openCharacterModal, openSettingModal, openTimelineEventModal } = useCreationModal();

  // 🎯 处理快捷键事件
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // 检查是否在输入框中，如果是则不触发快捷键
    const target = event.target as HTMLElement;
    const isInputElement = 
      target.tagName === 'INPUT' || 
      target.tagName === 'TEXTAREA' || 
      target.contentEditable === 'true';

    // 如果在输入框中按下 Cmd/Ctrl+S，仍然允许保存操作
    if (isInputElement && !(event.metaKey || event.ctrlKey) && event.key === 's') {
      return;
    }

    // Cmd/Ctrl 组合键处理
    if (event.metaKey || event.ctrlKey) {
      switch (event.key) {
        case 'k':
          // Cmd+K: 打开命令面板
          event.preventDefault();
          openModal('commandPalette');
          break;
        
        case 's':
          // Cmd+S: 强制保存（显示保存提示）
          event.preventDefault();
          toast.success("数据已自动保存", {
            description: "您的所有更改都已安全保存",
            duration: 2000,
          });
          break;
        
        case 'Shift':
          // 处理 Shift 组合键
          if (event.shiftKey) {
            switch (event.key.toLowerCase()) {
              case 'c':
                // Cmd+Shift+C: 快速创建角色
                event.preventDefault();
                openCharacterModal();
                break;
              
              case 's':
                // Cmd+Shift+S: 快速创建场景
                event.preventDefault();
                openSettingModal();
                break;
              
              case 'e':
                // Cmd+Shift+E: 快速创建时间线事件
                event.preventDefault();
                openTimelineEventModal();
                break;
            }
          }
          break;
      }
    }
  }, [openModal, openCharacterModal, openSettingModal, openTimelineEventModal]);

  // 🎯 注册和清理事件监听器
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    
    // 清理函数
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // 返回快捷键说明，供 UI 显示
  const shortcuts = [
    { key: 'Cmd+K', description: '打开命令面板' },
    { key: 'Cmd+Shift+C', description: '快速创建角色' },
    { key: 'Cmd+Shift+S', description: '快速创建场景' },
    { key: 'Cmd+Shift+E', description: '快速创建时间线事件' },
    { key: 'Cmd+S', description: '保存确认' },
  ];

  return { shortcuts };
};