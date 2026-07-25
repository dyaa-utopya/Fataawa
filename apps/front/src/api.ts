import { jeton } from './auth.js';
import type { AskResponse, FichierPret, LivreResume } from './types.js';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Appel authentifié (espace d'ajout de fatwas). */
async function appelAdmin<T>(chemin: string, body?: unknown): Promise<T> {
  const token = await jeton();
  if (token === null) throw new ApiError(401);
  const res = await fetch(`/api/v1/admin${chemin}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export async function listerLivres(): Promise<LivreResume[]> {
  return (await appelAdmin<{ livres: LivreResume[] }>('/livres')).livres;
}

export async function demanderUploadUrls(
  livre: string,
  fichiers: Array<{ nom: string; type: string }>,
): Promise<FichierPret[]> {
  return (await appelAdmin<{ fichiers: FichierPret[] }>('/upload-url', { livre, fichiers })).fichiers;
}

export async function adminIngerer(): Promise<void> {
  await appelAdmin('/ingerer', {});
}

export async function ask(
  question: string,
  conversationId: string | null,
  langue: string,
  questionConfirmee = false,
): Promise<AskResponse> {
  // la consultation est publique : pas de jeton requis ici
  const res = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question,
      ...(conversationId ? { conversationId } : {}),
      langue,
      questionConfirmee,
    }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as AskResponse;
}
