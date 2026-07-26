import { jeton } from './auth.js';
import { jetonAppCheck } from './firebase.js';
import type {
  AskResponse,
  FichierPret,
  LivreResume,
  Rapport,
  ResultatRecherche,
  Taxonomie,
  Verification,
} from './types.js';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * En-têtes d'un appel public : App Check atteste que la requête vient de ce
 * site. Le jeton est joint quand il est disponible, jamais exigé côté client —
 * c'est le serveur qui tranche.
 */
async function entetesPubliques(): Promise<Record<string, string>> {
  const { jeton: attestation, echec } = await jetonAppCheck();
  return {
    'content-type': 'application/json',
    ...(attestation === null
      ? // en-tête de diagnostic, jamais une autorisation : il dit seulement
        // POURQUOI l'attestation manque, pour que le journal le montre
        { 'X-AppCheck-Diag': echec || 'inconnu' }
      : { 'X-Firebase-AppCheck': attestation }),
  };
}

/** Appel authentifié (espace d'ajout de fatwas). */
async function appelAdmin<T>(chemin: string, body?: unknown): Promise<T> {
  const token = await jeton();
  if (token === null) throw new ApiError(401);
  const { jeton: attestation } = await jetonAppCheck();
  const res = await fetch(`/api/v1/admin${chemin}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(attestation === null ? {} : { 'X-Firebase-AppCheck': attestation }),
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

export async function listerThemes(): Promise<Taxonomie> {
  return appelAdmin<Taxonomie>('/themes');
}

/** Relevé des fatwas incomplètes ; balaie la collection, d'où l'attente. */
export async function chargerRapport(collection?: string): Promise<Rapport> {
  return appelAdmin<Rapport>(
    collection === undefined ? '/rapport' : `/rapport?collection=${encodeURIComponent(collection)}`,
  );
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
  // la consultation est publique : aucune connexion requise, seule l'attestation
  // App Check accompagne l'appel
  const res = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: await entetesPubliques(),
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
/**
 * Lecture d'une page téléversée : rend son texte, sans voyelles, pour qu'il
 * puisse être relu et corrigé avant vocalisation. Le fichier part tel quel —
 * l'encoder en base64 dans du JSON gonflerait le transfert d'un tiers.
 */
export async function lirePage(fichier: File): Promise<string> {
  const { jeton: attestation, echec } = await jetonAppCheck();
  const res = await fetch('/api/v1/voyelles/page', {
    method: 'POST',
    headers: {
      'content-type': fichier.type,
      ...(attestation === null
        ? { 'X-AppCheck-Diag': echec || 'inconnu' }
        : { 'X-Firebase-AppCheck': attestation }),
    },
    body: fichier,
  });
  if (!res.ok) throw new ApiError(res.status);
  return ((await res.json()) as { texte: string }).texte;
}

/**
 * Vocalisation — service distinct : aucune conversation, aucun corpus. Le texte
 * n'est pas conservé côté serveur.
 */
export interface Vocalisation {
  texte: string;
  vocalises: number;
  /** Bornes des mots restés sans signes, relevées par le serveur. */
  nus: Array<[number, number]>;
  mots: number;
}

export async function vocaliser(texte: string): Promise<Vocalisation> {
  const res = await fetch('/api/v1/voyelles', {
    method: 'POST',
    headers: await entetesPubliques(),
    body: JSON.stringify({ texte }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as Vocalisation;
}

export async function rechercher(requete: string, limite = 15): Promise<ResultatRecherche[]> {
  const res = await fetch('/api/v1/search', {
    method: 'POST',
    headers: await entetesPubliques(),
    body: JSON.stringify({ requete, limite }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return ((await res.json()) as { resultats: ResultatRecherche[] }).resultats;
}
