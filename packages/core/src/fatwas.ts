import { jetonsTexte } from './lexique.js';
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
  /** Thèmes sur trois niveaux (pipeline actuel) ; les deux premiers sont pris
   *  dans la taxonomie, le troisième est le sujet précis. */
  theme_n1?: string;
  theme_n2?: string;
  theme_n3?: string;
  /** Faux si un niveau manque ou sort de la taxonomie : repris par le rapport. */
  themes_complets?: boolean;
  gcs_path?: string;
  pages?: PageSourceRef[];
  statut?: 'STRUCTUREE' | 'EN_LIGNE';
  source?: string;
  /**
   * Mots de la fatwa, normalisés, pour la recherche par mots-clés — Firestore
   * n'ayant pas de plein texte, c'est ce tableau que `array-contains`
   * interroge. Alimenté par le pipeline et, sur les fatwas déjà en base, par le
   * job `index-mots`.
   */
  mots?: string[];
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
  /** Sujet précis (niveau 3) ; vide sur les fatwas de l'ancien pipeline. */
  themeN3: string;
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
    // les fatwas du pipeline portent les trois niveaux ; les historiques
    // n'ont que les deux champs d'origine, d'où le repli
    sujetPrincipal: data.theme_n1 ?? data.sujet_principal ?? '',
    sousSujet: data.theme_n2 ?? data.sous_sujet ?? '',
    themeN3: data.theme_n3 ?? '',
    texte: data.texte_arabe ?? '',
    pages: data.pages ?? [],
    imageSource: data.image_source ?? '',
    numeroPage: Number.isSafeInteger(numeroPage) ? numeroPage : null,
  };
}

/** Texte envoyé à l'embedding : sujets puis contenu. */
export function texteAEmbedder(f: Fatwa): string {
  return [f.sujetPrincipal, f.sousSujet, f.themeN3, f.texte].filter((s) => s !== '').join('\n');
}

export interface FatwaPipelineWrite {
  livreId: string;
  numero: string;
  sousQuestion?: string;
  /** Nom de fichier du scan, décrit comme sur les fatwas historiques. */
  imageSource?: string;
  themeN1: string;
  themeN2: string;
  themeN3: string;
  themesComplets: boolean;
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
    theme_n1: f.themeN1,
    theme_n2: f.themeN2,
    theme_n3: f.themeN3,
    themes_complets: f.themesComplets,
    // les deux champs historiques restent alimentés : l'API et le front les
    // lisent encore, et la collection en service ne connaît qu'eux
    sujet_principal: f.themeN1,
    sous_sujet: f.themeN2,
    texte_arabe: f.texte,
    pages: f.pages,
    numero_page: premiere ? String(premiere.numero) : '',
    gcs_path: premiere?.gcsPath ?? '',
    // même description du scan que les fatwas historiques, en plus du chemin
    image_source: f.imageSource ?? '',
    statut: 'STRUCTUREE',
    source: 'pipeline',
    // les thèmes entrent dans l'index lexical au même titre que le texte : le
    // lecteur qui tape « زكاة » doit atteindre une fatwa rangée sous ce thème
    // même si le mot ne figure pas dans son corps
    mots: motsIndexables(f.themeN1, f.themeN2, f.themeN3, f.numero, f.texte),
  };
}

/**
 * Mots indexables d'une fatwa, thèmes et numéro compris.
 *
 * Le numéro y entre en clair pour que « 2677 » le trouve même si le texte
 * l'imprime en chiffres arabes : la normalisation ramène les deux graphies à la
 * même forme.
 */
export function motsIndexables(
  themeN1: string,
  themeN2: string,
  themeN3: string,
  numero: string,
  texte: string,
): string[] {
  return jetonsTexte([themeN1, themeN2, themeN3, numero, texte].filter((s) => s !== '').join(' '));
}

/**
 * Chemin du scan historique à partir du seul nom de fichier.
 *
 * Deux pièges. Le bucket range les pages par livre (`legacy/{livre}/{nom}`)
 * alors que les fatwas de l'ancienne collection ne connaissent que le nom du
 * fichier. Et ce nom y est enregistré en forme Unicode DÉCOMPOSÉE (ا suivi
 * d'un hamza séparé) là où les objets du bucket portent la forme composée :
 * sans normalisation, aucun rapprochement n'aboutit.
 */
export function cheminScanLegacy(prefixe: string, imageSource: string): string {
  const nom = imageSource.normalize('NFC');
  const base = /^(.*)_Page\d+\.(?:png|jpe?g)$/i.exec(nom)?.[1] ?? '';
  return base === '' ? `${prefixe}${nom}` : `${prefixe}${base}/${nom}`;
}
