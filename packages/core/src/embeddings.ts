import { type GeminiCallOptions, geminiPost } from './gemini.js';

const MAX_EMBED_CHARS = 20_000;

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbeddingRequest {
  model: string;
  dim: number;
  taskType: EmbeddingTaskType;
}

/** Parse défensif de la réponse embedContent (testé unitairement). */
export function parseEmbedContent(json: unknown): number[] {
  const values = (json as { embedding?: { values?: unknown } } | null)?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'number')) {
    throw new Error('réponse embedContent invalide');
  }
  return values as number[];
}

/** Embedding d'un texte via l'API Gemini, dimension contrôlée. */
export async function geminiEmbedText(
  text: string,
  req: EmbeddingRequest,
  opts: GeminiCallOptions,
): Promise<number[]> {
  const json = await geminiPost(
    `/models/${req.model}:embedContent`,
    {
      content: { parts: [{ text: text.slice(0, MAX_EMBED_CHARS) }] },
      taskType: req.taskType,
      outputDimensionality: req.dim,
    },
    opts,
  );
  const values = parseEmbedContent(json);
  if (values.length !== req.dim) {
    throw new Error(`embedding de dimension ${values.length}, attendu ${req.dim}`);
  }
  return values;
}
