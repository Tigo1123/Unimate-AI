import { createHash } from 'node:crypto';

export const GENERATION_BATCH_TOKEN_BUDGET = 200_000;
export const GENERATION_PROMPT_TOKEN_RESERVE = 2_000;
export const CONSERVATIVE_GENERATION_BATCH_TOKEN_BUDGET = 24_000;

export function generationBatchTokenBudget(provider: string, model: string) {
  return provider === 'gemini' && model === 'gemini-3.5-flash'
    ? GENERATION_BATCH_TOKEN_BUDGET
    : CONSERVATIVE_GENERATION_BATCH_TOKEN_BUDGET;
}

type TokenChunk = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
};

export function estimatedChunkInputTokens(chunk: TokenChunk) {
  // Account for document/section labels wrapped around each stored chunk.
  return Math.max(chunk.tokenCount, Math.ceil(chunk.content.length / 4)) + 40;
}

export function tokenAwareBatches<T extends TokenChunk>(
  chunks: T[],
  tokenBudget = GENERATION_BATCH_TOKEN_BUDGET,
) {
  if (tokenBudget <= GENERATION_PROMPT_TOKEN_RESERVE)
    throw new Error('Generation token budget must leave room for the prompt.');
  const contentBudget = tokenBudget - GENERATION_PROMPT_TOKEN_RESERVE;
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;
  for (const chunk of chunks) {
    const tokens = estimatedChunkInputTokens(chunk);
    if (tokens > contentBudget)
      throw new Error(`Document chunk ${chunk.id} exceeds the safe generation input budget.`);
    if (current.length && currentTokens + tokens > contentBudget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(chunk);
    currentTokens += tokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function estimatedInputTokens(chunks: TokenChunk[]) {
  return (
    GENERATION_PROMPT_TOKEN_RESERVE +
    chunks.reduce((total, chunk) => total + estimatedChunkInputTokens(chunk), 0)
  );
}

export function stableGenerationKey(input: {
  userId: string;
  courseId: string;
  feature: string;
  model: string;
  language: string;
  parameters: Record<string, unknown>;
  chunks: TokenChunk[];
}) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      version: 1,
      userId: input.userId,
      courseId: input.courseId,
      feature: input.feature,
      model: input.model,
      language: input.language,
      parameters: input.parameters,
    }),
  );
  for (const chunk of input.chunks) {
    hash.update('\0');
    hash.update(chunk.id);
    hash.update('\0');
    hash.update(chunk.sourceId);
    hash.update('\0');
    hash.update(String(chunk.chunkIndex));
    hash.update('\0');
    hash.update(chunk.content);
  }
  return hash.digest('hex');
}
