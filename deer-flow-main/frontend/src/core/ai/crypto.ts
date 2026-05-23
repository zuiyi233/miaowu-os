export type EncryptionKeySource = "server";

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

export function encryptApiKey(apiKey: string): string {
  return apiKey || "";
}

export function decryptApiKeyWithStatus(encryptedKey: string): DecryptApiKeyResult {
  return { value: encryptedKey || "", issue: null };
}

export function decryptApiKey(encryptedKey: string): string {
  return decryptApiKeyWithStatus(encryptedKey).value;
}

export function isEncrypted(value: string): boolean {
  return Boolean(value?.startsWith("U2FsdGVkX1"));
}

export function validateEncryptionConfig(): {
  isValid: boolean;
  source: string;
  keyFingerprint: string;
} {
  return {
    isValid: true,
    source: "server-side",
    keyFingerprint: "server-managed",
  };
}
