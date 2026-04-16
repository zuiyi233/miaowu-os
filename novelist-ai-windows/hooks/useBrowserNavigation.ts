import { useEffect } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { useModalStore } from '../stores/useModalStore';

export const useBrowserNavigation = () => {
  const { viewMode, setViewMode } = useUiStore();
  const { config, close } = useModalStore();

  useEffect(() => {
    // 当打开 Modal 或切换非 Editor 视图时，推入历史记录
    if (config || viewMode !== 'editor') {
      window.history.pushState({ type: 'overlay' }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      // 拦截后退事件
      if (config) {
        // 如果有 Modal 打开，关闭它
        close();
      } else if (viewMode !== 'editor') {
        // 如果在其他视图，回到编辑器
        setViewMode('editor');
      }
      // 如果都在初始状态，则允许浏览器默认行为（退出应用）
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [config, viewMode, close, setViewMode]);
};