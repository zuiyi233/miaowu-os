import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore
import HttpProxy from "http-proxy";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "dynamic-proxy-middleware",
      configureServer(server) {
        console.log("🔧 [Proxy] 初始化自定义动态代理中间件...");

        let proxy: any;

        try {
          // ✅ 修复：移除自定义的 httpsAgent，让 http-proxy 自动处理 SSL/TLS
          // 之前的 keepAlive: false 和自定义 agent 导致了握手失败
          proxy = HttpProxy.createProxyServer({
            changeOrigin: true, // 关键：修改 Host 头，这对 SNI 至关重要
            secure: false, // 允许自签名证书
            ws: true, // 支持 WebSocket
            xfwd: true, // 添加 x-forwarded-for 头
            autoRewrite: true, // 自动重写重定向
            followRedirects: true, // 跟随重定向
          });

          proxy.on("error", (err: Error, _req: any, res: any) => {
            console.error("❌ [Proxy Error] 网络错误:", err.message);
            if (res.writeHead && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
            }
            if (!res.finished) {
              res.end(
                JSON.stringify({
                  error: "Proxy Network Error",
                  details: err.message,
                })
              );
            }
          });

          proxy.on("proxyReq", (proxyReq: any, req: any) => {
            // 移除内部 header，防止冲突
            proxyReq.removeHeader("x-proxy-target");
            // ✅ 修复：移除强制 Connection: close，允许复用连接
            // proxyReq.setHeader("Connection", "close");
          });
        } catch (e) {
          console.error("⚠️ 初始化 http-proxy 失败", e);
        }

        // 2. 挂载中间件
        server.middlewares.use("/api/proxy", (req, res, next) => {
          if (!proxy) return next();

          try {
            const urlObj = new URL(req.url || "", "http://localhost");
            const targetParam = urlObj.searchParams.get("__target");

            if (!targetParam) {
              res.statusCode = 400;
              res.end("Missing __target parameter");
              return;
            }

            const target = decodeURIComponent(targetParam);

            // 清理参数
            urlObj.searchParams.delete("__target");
            req.url = urlObj.pathname + urlObj.search;

            console.log(`🎯 [Proxy] 转发: ${req.method} ${target}`);

            proxy.web(req, res, {
              target,
              changeOrigin: true,
              secure: false, // ✅ 再次确保这里也是 false
            });
          } catch (err) {
            console.error("❌ [Proxy Middleware] 处理异常:", err);
            next(err);
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
});
