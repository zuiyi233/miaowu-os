import { useEffect } from "react";
import { useUiStore } from "../stores/useUiStore";
import { useUpdateChapterMutation } from "../lib/react-query/chapter.queries";

/**
 * 防止用户意外关闭页面导致未保存数据丢失的 Hook
 * 遵循单一职责原则，专注于数据保护
 */
export const useUnsavedChangesWarning = () => {
  const { dirtyContent, activeChapterId } = useUiStore();
  const updateChapterMutation = useUpdateChapterMutation();

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyContent !== null && activeChapterId) {
        // 1. 触发浏览器原生的"你确定要离开吗"弹窗
        e.preventDefault();
        e.returnValue = "";
        
        // 2. 尝试在后台发送最后一次保存 (尽力而为)
        // 注意：fetch/XHR 在页面关闭时可能被中断
        // 这里我们主要依赖浏览器的弹窗阻止用户误操作
        try {
          // 尝试同步保存，但不等待结果（因为页面即将关闭）
          updateChapterMutation.mutate({
            chapterId: activeChapterId,
            content: dirtyContent,
            createSnapshot: false // 避免在紧急保存时创建快照
          });
        } catch (error) {
          // 忽略保存错误，因为主要目的是显示警告
          console.warn("紧急保存尝试失败，但警告已显示", error);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirtyContent, activeChapterId, updateChapterMutation]);
};