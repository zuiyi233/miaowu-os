export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * (vecB[i] ?? 0), 0);
  const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

export function euclideanNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((acc, val) => acc + val * val, 0));
}

export function euclideanDistance(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) throw new Error("向量维度必须相同");
  return Math.sqrt(vecA.reduce((acc, val, i) => acc + (val - (vecB[i] ?? 0)) ** 2, 0));
}

export function normalizeVector(vector: number[]): number[] {
  const norm = euclideanNorm(vector);
  if (norm === 0) throw new Error("无法归一化零向量");
  return vector.map((val) => val / norm);
}
