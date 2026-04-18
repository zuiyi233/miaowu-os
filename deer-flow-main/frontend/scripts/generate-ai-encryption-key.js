#!/usr/bin/env node

/**
 * AI Provider Encryption Key Generator
 *
 * 生成用于加密API密钥的安全随机密钥。
 * 生产环境必须使用独立密钥，不要使用默认的开发密钥。
 *
 * 使用方法：
 *   pnpm run generate:ai-key
 *
 * 输出：
 *   - 控制台显示生成的密钥
 */

import crypto from "crypto";

function generateEncryptionKey() {
  const key = crypto.randomBytes(32).toString("base64");

  console.log("\n" + "=".repeat(60));
  console.log("🔐 AI Provider Encryption Key Generated");
  console.log("=".repeat(60) + "\n");

  console.log("📋 生成的加密密钥:\n");
  console.log(`\x1b[33m${key}\x1b[0m\n`);

  console.log("📝 使用说明:");
  console.log("-".repeat(40));
  console.log("1. 复制上面的密钥");
  console.log('2. 添加到 .env 文件:');
  console.log('\x1b[36m' + `NEXT_PUBLIC_AI_ENCRYPTION_KEY="${key}"` + '\x1b[0m');
  console.log("\n3. 重启开发服务器使配置生效\n");

  console.log("⚠️  安全提醒:");
  console.log("-".repeat(40));
  console.log("✅ 每个部署环境应使用不同的密钥");
  console.log("✅ 不要将密钥提交到版本控制系统");
  console.log("✅ 定期轮换密钥（建议每90天）");
  console.log("✅ 确保 .env 文件已添加到 .gitignore\n");

  console.log("=".repeat(60) + "\n");

  return key;
}

try {
  generateEncryptionKey();
} catch (error) {
  console.error("❌ 生成密钥失败:", error.message);
  process.exit(1);
}
