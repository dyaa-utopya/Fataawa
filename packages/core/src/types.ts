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

/** Document livres/{livreId} — livreId = ID du dossier Drive du livre. */
export interface LivreDoc {
  titre: string;
  driveFolderId: string;
  statut: 'EN_COURS' | 'TERMINE';
  nbPages: number;
  nbPagesOcr: number;
  /** Dernière page structurée (phase 2) ; 0 = rien de structuré. */
  curseurStructuration: number;
  /** Fatwa coupée en fin de page, en attente de la page suivante (phase 2). */
  fatwaOuverte: unknown | null;
  creeAt: Timestamp;
  majAt: Timestamp;
}

/** Document livres/{livreId}/pages/{pageId} — pageId = numéro zéro-paddé (tri lexical = ordre de lecture). */
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
