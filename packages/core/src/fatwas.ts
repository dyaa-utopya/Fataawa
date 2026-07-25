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

/** Un vrai bloc de fatwa porte l'un de ces repères imprimés. */
const MARQUEUR_FATWA = /(^|[\s([])[سج]\s*[٠-٩0-9]*\s*[:：]|السؤال|الجواب|الفتوى\s+رقم|سئل/u;
const LETTRE_ARABE = /[ء-ي]/u;
const PAGE_VIDE = /^[[(]?\s*(ال)?صفحة\s+فارغة\s*[\])]?\.?$/u;
/** En deçà, un texte sans repère de question n'est pas une fatwa mais un titre. */
const LONGUEUR_MINIMALE = 150;

/**
 * Vrai pour les documents que l'ancien pipeline a tirés des pages qui ne
 * portent pas de fatwa : lignes de sommaire (« تفسير سورة الكهف », « ٤٥١ . . .
 * »), numéros de page seuls, marqueurs « الصفحة فارغة », et queues de fatwa
 * détachées de leur en-tête. Ils encombrent la recherche sans rien apprendre.
 *
 * Mesuré sur les 7 149 fatwas en service : 698 écartés (9,8 %), dont 81
 * pages vides et 19 lignes de chiffres nus ; aucune fatwa pourvue d'un repère
 * de question n'est touchée, même très courte.
 *
 * Filet de lecture, pas de vérité : le retraitement des recueils supprime ces
 * documents à la source — les pages de sommaire n'y produisent aucune fatwa.
 */
export function estArtefactSansFatwa(texte: string): boolean {
  const t = texte.trim();
  if (!LETTRE_ARABE.test(t)) return true;
  if (PAGE_VIDE.test(t)) return true;
  return t.length < LONGUEUR_MINIMALE && !MARQUEUR_FATWA.test(t);
}

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
  /** Repère de sous-question dans une fatwa qui en contient plusieurs. */
  sous_question?: string;
  question_arabe?: string;
  reponse_arabe?: string;
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
  /** Vide si la fatwa ne porte qu'une seule question. */
  sousQuestion: string;
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
    sousQuestion: data.sous_question ?? '',
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
  sousQuestion?: string;
  /** Nom de fichier du scan, décrit comme sur les fatwas historiques. */
  imageSource?: string;
  sujetPrincipal: string;
  sousSujet: string;
  texte: string;
  question?: string;
  reponse?: string;
  pages: PageSourceRef[];
}

/** Fatwa produite par le pipeline, écrite avec les noms de champs de la collection. */
export function fromPipeline(f: FatwaPipelineWrite): FatwaStored {
  const premiere = f.pages[0];
  return {
    livre_id: f.livreId,
    numero_fatwa: f.numero,
    sous_question: f.sousQuestion ?? '',
    question_arabe: f.question ?? '',
    reponse_arabe: f.reponse ?? '',
    sujet_principal: f.sujetPrincipal,
    sous_sujet: f.sousSujet,
    texte_arabe: f.texte,
    pages: f.pages,
    numero_page: premiere ? String(premiere.numero) : '',
    gcs_path: premiere?.gcsPath ?? '',
    // même description du scan que les fatwas historiques, en plus du chemin
    image_source: f.imageSource ?? '',
    statut: 'STRUCTUREE',
    source: 'pipeline',
  };
}
