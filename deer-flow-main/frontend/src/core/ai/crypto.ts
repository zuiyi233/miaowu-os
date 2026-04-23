import CryptoJS from "crypto-js";

const ENV_KEY_NAME = "NEXT_PUBLIC_AI_ENCRYPTION_KEY";
const LOCAL_STORAGE_KEY = "deerflow_ai_encryption_key";
const KEY_FINGERPRINT_KEY = "deerflow_ai_encryption_key_fingerprint";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export type EncryptionKeySource = "environment" | "local-storage" | "session";

interface KeyFingerprintRecord {
  fingerprint: string;
  source: EncryptionKeySource;
  recordedAt: number;
}

export interface DecryptApiKeyIssue {
  message: string;
  keyFingerprint: string;
  keySource: EncryptionKeySource;
  previousFingerprint: string | null;
  sourceChanged: boolean;
}

export interface DecryptApiKeyResult {
  value: string;
  issue: DecryptApiKeyIssue | null;
}

function computeKeyFingerprint(key: string): string {
  if (!key) return "";
  const sample = key.length > 8 ? key.slice(0, 4) + key.slice(-4) : key;
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

function readKeyFingerprintRecord(): KeyFingerprintRecord | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(KEY_FINGERPRINT_KEY);
      if (!stored) {
        return null;
      }

      try {
        const parsed = JSON.parse(stored) as Partial<KeyFingerprintRecord>;
        if (typeof parsed?.fingerprint === "string" && parsed.fingerprint) {
          return {
            fingerprint: parsed.fingerprint,
            source:
              parsed.source === "environment" ||
              parsed.source === "local-storage" ||
              parsed.source === "session"
                ? parsed.source
                : "local-storage",
            recordedAt:
              typeof parsed.recordedAt === "number" ? parsed.recordedAt : 0,
          };
        }
      } catch {
        return {
          fingerprint: stored,
          source: "local-storage",
          recordedAt: 0,
        };
      }
    }
  } catch {}
  return null;
}

function persistKeyFingerprint(record: KeyFingerprintRecord): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(KEY_FINGERPRINT_KEY, JSON.stringify(record));
    }
  } catch {}
}

function recordKeyFingerprint(source: EncryptionKeySource, key: string): {
  fingerprint: string;
  previousRecord: KeyFingerprintRecord | null;
  sourceChanged: boolean;
} {
  const fingerprint = computeKeyFingerprint(key);
  const previousRecord = readKeyFingerprintRecord();
  const sourceChanged = Boolean(previousRecord && previousRecord.source !== source);
  persistKeyFingerprint({
    fingerprint,
    source,
    recordedAt: Date.now(),
  });
  return { fingerprint, previousRecord, sourceChanged };
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

function getEncryptionKeyState(): { key: string; source: EncryptionKeySource } {
  const envKey = process.env[ENV_KEY_NAME];

  if (envKey && envKey.trim() !== "") {
    const trimmedKey = envKey.trim();
    const { fingerprint, previousRecord, sourceChanged } = recordKeyFingerprint(
      "environment",
      trimmedKey
    );

    if (isProduction()) {
      console.log("✅ AI Provider: 使用生产环境加密密钥");
    }

    if (
      previousRecord &&
      (previousRecord.fingerprint !== fingerprint || sourceChanged)
    ) {
      console.warn(
        "⚠️ AI Provider: 检测到环境加密密钥指纹变化，已有加密数据可能需要重新录入。"
      );
    }

    return { key: trimmedKey, source: "environment" };
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
        const { fingerprint, previousRecord, sourceChanged } = recordKeyFingerprint(
          "local-storage",
          cachedKey
        );
        if (
          previousRecord &&
          (previousRecord.fingerprint !== fingerprint || sourceChanged)
        ) {
          console.warn(
            "⚠️ AI Provider: 加密密钥指纹与上次不同（可能因清除浏览器数据导致密钥变更），" +
            "此前加密的 API Key 可能需要重新录入。"
          );
        }
        return { key: cachedKey, source: "local-storage" };
      }

      const newKey = generateSecureKey();
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, newKey);
        recordKeyFingerprint("local-storage", newKey);
      } catch (storageError) {
        console.warn("无法写入localStorage，开发密钥仅在当前会话内生效", storageError);
      }

      console.log("🔐 AI Provider: 已生成新的开发密钥并缓存");

      return { key: newKey, source: "local-storage" };
    }
  } catch {
    console.warn("无法访问localStorage，使用会话临时密钥");
  }

  const sessionKey = generateSecureKey();
  console.log("🔐 AI Provider: 使用会话临时密钥（不持久化）");

  return { key: sessionKey, source: "session" };
}

const ENCRYPTION_KEY_STATE = getEncryptionKeyState();
const ENCRYPTION_KEY = ENCRYPTION_KEY_STATE.key;
const ENCRYPTION_KEY_SOURCE = ENCRYPTION_KEY_STATE.source;

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return "";
  return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
}

export function decryptApiKeyWithStatus(encryptedKey: string): DecryptApiKeyResult {
  if (!encryptedKey) return { value: "", issue: null };
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (decrypted) {
      return { value: decrypted, issue: null };
    }
    if (isEncrypted(encryptedKey)) {
      const currentRecord = recordKeyFingerprint(
        ENCRYPTION_KEY_SOURCE,
        ENCRYPTION_KEY
      );
      const keyChanged =
        Boolean(currentRecord.previousRecord) &&
        currentRecord.previousRecord?.fingerprint !== currentRecord.fingerprint;

      return {
        value: "",
        issue: {
          message: keyChanged
            ? "检测到已加密配置解密失败：加密密钥已变更，请重新录入 API Key。"
            : "检测到已加密配置解密失败，请重新录入 API Key。",
          keyFingerprint: currentRecord.fingerprint,
          keySource: ENCRYPTION_KEY_SOURCE,
          previousFingerprint: currentRecord.previousRecord?.fingerprint ?? null,
          sourceChanged: currentRecord.sourceChanged || keyChanged,
        },
      };
    }
    return { value: encryptedKey, issue: null };
  } catch {
    if (isEncrypted(encryptedKey)) {
      const currentRecord = recordKeyFingerprint(
        ENCRYPTION_KEY_SOURCE,
        ENCRYPTION_KEY
      );
      const keyChanged =
        Boolean(currentRecord.previousRecord) &&
        currentRecord.previousRecord?.fingerprint !== currentRecord.fingerprint;

      return {
        value: "",
        issue: {
          message: keyChanged
            ? "检测到已加密配置解密异常：加密密钥已变更，请重新录入 API Key。"
            : "检测到已加密配置解密异常，请重新录入 API Key。",
          keyFingerprint: currentRecord.fingerprint,
          keySource: ENCRYPTION_KEY_SOURCE,
          previousFingerprint: currentRecord.previousRecord?.fingerprint ?? null,
          sourceChanged: currentRecord.sourceChanged || keyChanged,
        },
      };
    }
    return { value: encryptedKey, issue: null };
  }
}

export function decryptApiKey(encryptedKey: string): string {
  return decryptApiKeyWithStatus(encryptedKey).value;
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  try {
    if (value.startsWith("U2FsdGVkX1")) return true;
    if (value.length > 80 && /^[A-Za-z0-9+/=]+$/.test(value)) return true;
    return false;
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
