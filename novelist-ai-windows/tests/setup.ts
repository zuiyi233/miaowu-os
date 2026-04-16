/**
 * Vitest 测试环境设置
 *
 * 配置测试环境，包括模拟浏览器 API 和 React Testing Library
 */

import { vi } from "vitest";

// 模拟 IndexedDB
import "fake-indexeddb/auto";

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
})();

// 使用 global 而不是 globalThis 以确保兼容性
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// 模拟 console 方法以避免测试输出干扰
Object.defineProperty(global, "console", {
  value: {
    ...console,
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  writable: true,
});

// 配置 React Testing Library
import "@testing-library/jest-dom";

// 模拟 ResizeObserver（用于一些 UI 组件）
Object.defineProperty(global, "ResizeObserver", {
  value: class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      //
    }
    observe(target: Element, options?: ResizeObserverOptions) {
      //
    }
    unobserve(target: Element) {
      //
    }
    disconnect() {
      //
    }
  },
  writable: true,
});

// 模拟 IntersectionObserver（用于一些 UI 组件）
Object.defineProperty(global, "IntersectionObserver", {
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
  writable: true,
});

// 模拟 matchMedia（用于响应式组件）
Object.defineProperty(global, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
