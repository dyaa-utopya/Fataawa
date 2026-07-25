import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const OCR_PROMPT = `Tu es un moteur d'OCR spécialisé dans les textes islamiques arabes.
Transcris fidèlement TOUT le texte arabe visible sur cette image de page de livre.
Règles strictes :
- Texte arabe uniquement, avec la ponctuation et les diacritiques visibles.
- Conserve les numéros de fatwas, titres et sous-titres, chacun sur sa propre ligne.
- Respecte l'ordre de lecture (droite à gauche, colonnes éventuelles).
- N'ajoute AUCUN commentaire, AUCUNE traduction, AUCUNE balise : texte brut seulement.
- Si la page est vide ou illisible, réponds exactement : [PAGE_VIDE]`;

/** Erreur HTTP de l'API Gemini (quota, serveur…) — retryable selon le statut. */
export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

/** Réponse 200 mais inutilisable (RECITATION, blocage, vide) → fallback Cloud Vision. */
export class GeminiUnusableError extends Error {
  constructor(readonly reason: string) {
    super(`réponse Gemini inutilisable : ${reason}`);
    this.name = 'GeminiUnusableError';
  }
}

export interface ParsedGenerateContent {
  text: string;
  finishReason?: string;
  blockReason?: string;
}

interface RawGenerateContent {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Parse minimal et défensif de la réponse generateContent (testé unitairement). */
export function parseGenerateContent(json: unknown): ParsedGenerateContent {
  const raw = (json ?? {}) as RawGenerateContent;
  const candidate = raw.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return {
    text,
    finishReason: candidate?.finishReason,
    blockReason: raw.promptFeedback?.blockReason,
  };
}

/** Valide qu'une réponse parsée est exploitable comme OCR, sinon GeminiUnusableError. */
export function ensureUsableOcr(parsed: ParsedGenerateContent): string {
  if (parsed.blockReason) throw new GeminiUnusableError(`blocage prompt (${parsed.blockReason})`);
  if (parsed.finishReason === 'RECITATION') throw new GeminiUnusableError('RECITATION');
  if (parsed.finishReason === 'SAFETY') throw new GeminiUnusableError('SAFETY');
  if (parsed.text === '') throw new GeminiUnusableError('texte vide');
  return parsed.text;
}

/** Header Retry-After (secondes ou date HTTP) → millisecondes. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

export interface GeminiOcrOptions {
  apiKey: string;
  model: string;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
}

const IN_PROCESS_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30_000;

/**
 * OCR d'une image de page via l'API Gemini (generateContent, image inline).
 * Retry en process (429/503, Retry-After honoré, plafonné) ; au-delà, l'erreur
 * remonte et c'est Cloud Tasks qui rejoue la tâche avec son propre backoff.
 */
export async function geminiOcrImage(
  image: Buffer,
  mimeType: string,
  opts: GeminiOcrOptions,
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${API_BASE}/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: image.toString('base64') } },
          { text: OCR_PROMPT },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
      body,
    });

    if (res.status === 429 || res.status === 503) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      if (attempt < IN_PROCESS_RETRIES) {
        const backoffMs = Math.min(retryAfterMs ?? 2000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
        await sleep(backoffMs);
        continue;
      }
      throw new GeminiHttpError(res.status, `Gemini ${res.status} après ${attempt + 1} essais`, retryAfterMs);
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new GeminiHttpError(res.status, `Gemini ${res.status} : ${detail}`);
    }
    return ensureUsableOcr(parseGenerateContent(await res.json()));
  }
}
