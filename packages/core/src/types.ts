import type { Timestamp } from '@google-cloud/firestore';
import { z } from 'zod';

export const STATUT_OCR = {
  A_TRAITER: 'A_TRAITER',
  EN_COURS: 'EN_COURS',
  TRAITE: 'TRAITE',
  QUARANTAINE: 'QUARANTAINE',
} as const;
export type StatutOcr = (typeof STATUT_OCR)[keyof typeof STATUT_OCR];

export type MoteurOcr = 'GEMINI' | 'VISION';

/** Durée du bail de structuration : au-delà, un passage est réputé mort. */
export const LEASE_STRUCT_MS = 8 * 60_000;

/** Référence légère vers une page source (portée par les fatwas). */
export interface PageSourceRef {
  numero: number;
  pageId: string;
  gcsPath: string;
}

/** Fatwa coupée en fin de fenêtre, en attente des pages suivantes. */
export interface FatwaOuverteState {
  numero: string;
  sousQuestion: string;
  themeN1: string;
  themeN2: string;
  themeN3: string;
  textePartiel: string;
  pages: PageSourceRef[];
  /** Page où le fragment a été ouvert : sert à l'abandonner s'il n'aboutit pas. */
  depuisPage?: number;
}

/** Document livres/{livreId} — livreId = ID du dossier Drive du livre. */
export interface LivreDoc {
  titre: string;
  driveFolderId: string;
  statut: 'EN_COURS' | 'TERMINE';
  nbPages: number;
  nbPagesOcr: number;
  nbFatwas: number;
  /** Dernière page structurée ; 0 = rien de structuré. */
  curseurStructuration: number;
  fatwaOuverte: FatwaOuverteState | null;
  /** Numéro de la dernière fatwa rencontrée : rattache celles dont l'en-tête est resté sur une page antérieure. */
  dernierNumeroFatwa?: string;
  /**
   * Dernière création de page. Les scans n'arrivent pas dans l'ordre : le
   * découpage doit patienter devant un trou tant que l'ingestion tourne, sinon
   * son curseur passe devant des pages qui n'existent pas encore et ne revient
   * jamais les chercher.
   */
  dernierePageAt?: Timestamp;
  /** Bail de structuration (une seule structuration active par livre). */
  structLease?: Timestamp;
  /**
   * Incrémenté à chaque remise à zéro du découpage. Un passage en cours compare
   * cette valeur à celle lue à son démarrage et s'arrête si elle a changé :
   * sans cela il réécrirait le curseur que la remise à zéro vient d'annuler.
   */
  generationStruct?: number;
  creeAt: Timestamp;
  majAt: Timestamp;
}

/** Document livres/{livreId}/pages/{pageId} — pageId = numéro zéro-paddé. */
export interface PageDoc {
  numero: number;
  gcsPath: string;
  mimeType: string;
  driveFileId: string;
  sha256: string;
  statutOcr: StatutOcr;
  texteOcr?: string;
  moteur?: MoteurOcr;
  tentatives: number;
  structTentatives?: number;
  derniereErreur?: string;
  ocrAt?: Timestamp;
  creeAt: Timestamp;
  majAt: Timestamp;
}

export const ocrTaskPayloadSchema = z.object({
  livreId: z.string().min(1),
  numeroPage: z.number().int().min(0),
});
export type OcrTaskPayload = z.infer<typeof ocrTaskPayloadSchema>;

export const structurerTaskPayloadSchema = z.object({
  livreId: z.string().min(1),
});
export type StructurerTaskPayload = z.infer<typeof structurerTaskPayloadSchema>;

export const embedTaskPayloadSchema = z.object({
  fatwaId: z.string().min(1),
});
export type EmbedTaskPayload = z.infer<typeof embedTaskPayloadSchema>;
