export const generateUniqueId = (prefix: string = "id"): string => {
  return `${prefix}-${crypto.randomUUID()}`;
};

export const generateCharacterId = (): string => generateUniqueId("char");
export const generateChapterId = (): string => generateUniqueId("chapter");
export const generateSettingId = (): string => generateUniqueId("setting");
export const generateVersionId = (): string => generateUniqueId("version");
