import { jeton } from './auth.js';
import type {
  AskResponse,
  FichierPret,
  LivreResume,
  ResultatRecherche,
  Verification,
} from './types.js';

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

export async function verifierLot(
  livre: string,
  fichiers: Array<{ nom: string; type: string }>,
): Promise<Verification> {
  return appelAdmin<Verification>('/verifier', { livre, fichiers });
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

export async function demanderPdfUrl(
  livre: string,
  nom: string,
): Promise<{ livreId: string; chemin: string; url: string }> {
  return appelAdmin('/pdf-url', { livre, nom });
}

export async function lancerDecoupage(livre: string, chemin: string): Promise<void> {
  await appelAdmin('/decouper', { livre, chemin });
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

/**
 * Recherche directe : renvoie les fatwas elles-mêmes, sans réponse rédigée.
 * Publique elle aussi, et indépendante de la conversation en cours.
 */
export async function rechercher(requete: string, limite = 15): Promise<ResultatRecherche[]> {
  const res = await fetch('/api/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requete, limite }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return ((await res.json()) as { resultats: ResultatRecherche[] }).resultats;
}
