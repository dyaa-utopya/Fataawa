import type { PageSourceRef } from './types.js';

/**
 * Couche d'accès à la collection historique `fatawas_db` (7 000+ fatwas déjà
 * en production). On conserve ses noms de champs — aucune migration de
 * données — et on n'ajoute que ce qui manque au pipeline.
 *
 * Embeddings : le champ historique `embedding` a été produit par un modèle
 * aujourd'hui retiré de l'API Gemini ; ses vecteurs sont incompatibles avec
 * `gemini-embedding-001` (similarité mesurée ≈ 0,04 sur un même texte). Le
 * nouveau vecteur vit donc dans `embedding_v2`, avec son index dédié, et
 * `embedding` reste intact pour permettre un retour arrière.
 */
export const CHAMP_EMBEDDING_ACTUEL = 'embedding_v2';
export const CHAMP_EMBEDDING_LEGACY = 'embedding';

/** Document tel qu'il est stocké dans `fatawas_db`. */
export interface FatwaStored {
  // champs historiques (présents sur les 7 000+ fatwas existantes)
  texte_arabe?: string;
  sujet_principal?: string;
  sous_sujet?: string;
  numero_fatwa?: string;
  numero_page?: string;
  image_source?: string;
  embedding?: unknown;
  // champs ajoutés par le pipeline Cloud Run
  embedding_v2?: unknown;
  embedding_model?: string;
  livre_id?: string;
  gcs_path?: string;
  pages?: PageSourceRef[];
  statut?: 'STRUCTUREE' | 'EN_LIGNE';
  source?: string;
}

/** Vue normalisée d'une fatwa, utilisée par l'API et le pipeline. */
export interface Fatwa {
  id: string;
  livreId: string;
  numero: string;
  sujetPrincipal: string;
  sousSujet: string;
  texte: string;
  /** Pages sources connues (fatwas issues du pipeline). */
  pages: PageSourceRef[];
  /** Nom de fichier du scan d'origine (fatwas historiques). */
  imageSource: string;
  numeroPage: number | null;
}

export function toFatwa(id: string, data: FatwaStored): Fatwa {
  const numeroPage = Number.parseInt(data.numero_page ?? '', 10);
  return {
    id,
    livreId: data.livre_id ?? '',
    numero: data.numero_fatwa ?? '',
    sujetPrincipal: data.sujet_principal ?? '',
    sousSujet: data.sous_sujet ?? '',
    texte: data.texte_arabe ?? '',
    pages: data.pages ?? [],
    imageSource: data.image_source ?? '',
    numeroPage: Number.isSafeInteger(numeroPage) ? numeroPage : null,
  };
}

/** Texte envoyé à l'embedding : sujets puis contenu. */
export function texteAEmbedder(f: Fatwa): string {
  return [f.sujetPrincipal, f.sousSujet, f.texte].filter((s) => s !== '').join('\n');
}

export interface FatwaPipelineWrite {
  livreId: string;
  numero: string;
  sujetPrincipal: string;
  sousSujet: string;
  texte: string;
  pages: PageSourceRef[];
}

/** Fatwa produite par le pipeline, écrite avec les noms de champs de la collection. */
export function fromPipeline(f: FatwaPipelineWrite): FatwaStored {
  const premiere = f.pages[0];
  return {
    livre_id: f.livreId,
    numero_fatwa: f.numero,
    sujet_principal: f.sujetPrincipal,
    sous_sujet: f.sousSujet,
    texte_arabe: f.texte,
    pages: f.pages,
    numero_page: premiere ? String(premiere.numero) : '',
    gcs_path: premiere?.gcsPath ?? '',
    statut: 'STRUCTUREE',
    source: 'pipeline',
  };
}
