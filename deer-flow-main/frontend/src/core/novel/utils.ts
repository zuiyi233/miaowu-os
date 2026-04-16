export function generateUniqueId(prefix: string = ''): string {
  const id = crypto.randomUUID().slice(0, 8);
  return prefix ? `${prefix}-${id}` : id;
}
