import CryptoJS from "crypto-js";

const ENV_KEY_NAME = "NEXT_PUBLIC_AI_ENCRYPTION_KEY";
const LOCAL_STORAGE_KEY = "deerflow_ai_encryption_key";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function generateSecureKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "当前环境不支持安全随机数生成（crypto.getRandomValues）。请升级浏览器后重试。"
    );
  }

  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

function getEncryptionKey(): string {
  const envKey = process.env[ENV_KEY_NAME];

  if (envKey && envKey.trim() !== "") {
    const trimmedKey = envKey.trim();

    if (isProduction()) {
      console.log("✅ AI Provider: 使用生产环境加密密钥");
    }

    return trimmedKey;
  }

  if (isProduction()) {
    console.error(
      "\n" +
        "❌❌❌ 安全错误 ❌❌❌\n" +
        `环境变量 ${ENV_KEY_NAME} 未配置！\n` +
        "生产环境必须设置独立的AI供应商加密密钥。\n\n" +
        "解决方案:\n" +
        "1. 运行: pnpm run generate:ai-key\n" +
        `2. 添加到环境变量: ${ENV_KEY_NAME}=<生成的密钥>\n` +
        "3. 重启应用\n\n"
    );

    throw new Error(
      `[Security Error] Production environment requires ${ENV_KEY_NAME} to be set. ` +
      `Run 'pnpm run generate:ai-key' to generate a secure key.`
    );
  }

  console.warn(
    "\n" +
      "⚠️  AI Provider 安全警告\n" +
      "-".repeat(40) + "\n" +
      `未检测到 ${ENV_KEY_NAME} 环境变量\n` +
      "开发模式将使用自动生成的临时密钥\n\n" +
      "⚠️  注意：\n" +
      "• 此密钥仅适用于本地开发\n" +
      "• 清除浏览器数据后已加密的数据将无法解密\n" +
      "• 生产部署前必须配置独立密钥\n" +
      "-".repeat(40) + "\n"
  );

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const cachedKey = window.localStorage.getItem(LOCAL_STORAGE_KEY);

      if (cachedKey) {
        console.log("✅ AI Provider: 使用缓存的开发密钥");
        return cachedKey;
      }

      const newKey = generateSecureKey();
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, newKey);
      } catch (storageError) {
        console.warn("无法写入localStorage，开发密钥仅在当前会话内生效", storageError);
      }

      console.log("🔐 AI Provider: 已生成新的开发密钥并缓存");

      return newKey;
    }
  } catch {
    console.warn("无法访问localStorage，使用会话临时密钥");
  }

  const sessionKey = generateSecureKey();
  console.log("🔐 AI Provider: 使用会话临时密钥（不持久化）");

  return sessionKey;
}

const ENCRYPTION_KEY = getEncryptionKey();

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return "";
  return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
}

export function decryptApiKey(encryptedKey: string): string {
  if (!encryptedKey) return "";
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (decrypted) {
      return decrypted;
    }
    if (isEncrypted(encryptedKey)) {
      console.warn("检测到已加密配置解密失败，已返回空值，请重新录入 API Key。");
      return "";
    }
    // 兼容历史明文存量：旧版本可能直接写入明文
    return encryptedKey;
  } catch {
    if (isEncrypted(encryptedKey)) {
      console.warn("检测到已加密配置解密异常，已返回空值，请重新录入 API Key。");
      return "";
    }
    // 兼容历史明文存量：旧版本可能直接写入明文
    return encryptedKey;
  }
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  try {
    return value.includes("U2FsdGVkX1") || value.length > 50;
  } catch {
    return false;
  }
}

export function validateEncryptionConfig(): {
  isValid: boolean;
  source: string;
  keyFingerprint: string;
} {
  const source = process.env[ENV_KEY_NAME]
    ? "environment-variable"
    : typeof window !== "undefined" &&
      window.localStorage?.getItem(LOCAL_STORAGE_KEY)
      ? "local-storage-cached"
      : "session-generated";

  return {
    isValid: ENCRYPTION_KEY.length > 0,
    source,
    keyFingerprint: "hidden",
  };
}
