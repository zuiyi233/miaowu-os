import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// ✅ 1. 引入 React Query 相关模块
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/react-query/client";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* ✅ 2. 在这里包裹 App，确保 App 内部的 Hooks 能使用 React Query */}
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);