/**
 * Core AI module exports.
 *
 * 提供全局AI服务的统一入口，包括：
 * - 状态管理（ai-provider-store）
 * - 服务接口（global-ai-service）
 * - 安全工具（crypto）
 * - 类型定义
 */

export {
  useAiProviderStore,
  type AiProviderConfig,
  type AiProviderType,
  type AiGlobalSettings,
} from "./ai-provider-store";

export {
  globalAiService,
  GlobalAiService,
  type AiMessage,
  type AiRequestOptions,
  type AiStreamCallbacks,
  type AiServiceError,
  type AiServiceContext,
} from "./global-ai-service";

export {
  encryptApiKey,
  decryptApiKey,
  isEncrypted,
  validateEncryptionConfig,
} from "./crypto";
