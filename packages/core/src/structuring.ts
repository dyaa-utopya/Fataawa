import { z } from 'zod';
import {
  type GeminiCallOptions,
  geminiGenerateText,
  stripJsonFences,
} from './gemini.js';
import { normalizeDigits } from './pages.js';
import type { FatwaOuverteState } from './types.js';

/** Sortie attendue de la structuration d'une page. */
export interface FatwaExtraite {
  numero: string;
  sujetPrincipal: string;
  sousSujet: string;
  texteComplet: string;
}

export interface FragmentOuvert {
  numero: string;
  sujetPrincipal: string;
  sousSujet: string;
  textePartiel: string;
}

export interface StructurationResult {
  fatwasCompletes: FatwaExtraite[];
  fatwaOuverte: FragmentOuvert | null;
}

const fatwaExtraiteSchema = z.object({
  numero_fatwa: z.string().default(''),
  sujet_principal: z.string().default(''),
  sous_sujet: z.string().default(''),
  texte_complet: z.string().min(1),
});

const structurationSchema = z.object({
  fatwas_completes: z.array(fatwaExtraiteSchema).default([]),
  fatwa_ouverte: z
    .object({
      numero_fatwa: z.string().default(''),
      sujet_principal: z.string().default(''),
      sous_sujet: z.string().default(''),
      texte_partiel: z.string().min(1),
    })
    .nullable()
    .default(null),
});

/** Schéma de réponse au format Gemini (responseSchema). */
export const STRUCTURATION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fatwas_completes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          numero_fatwa: { type: 'STRING' },
          sujet_principal: { type: 'STRING' },
          sous_sujet: { type: 'STRING' },
          texte_complet: { type: 'STRING' },
        },
        required: ['texte_complet'],
      },
    },
    fatwa_ouverte: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        numero_fatwa: { type: 'STRING' },
        sujet_principal: { type: 'STRING' },
        sous_sujet: { type: 'STRING' },
        texte_partiel: { type: 'STRING' },
      },
      required: ['texte_partiel'],
    },
  },
  required: ['fatwas_completes'],
} as const;

export const STRUCTURATION_SYSTEM = `Tu structures des recueils de fatwas arabes, page par page, dans l'ordre de lecture.
Tu reçois le texte OCR d'UNE page, précédé éventuellement d'un FRAGMENT EN ATTENTE
(fatwa commencée sur les pages précédentes, dont le début de cette page est la suite).
Règles strictes :
1. Découpe le texte en fatwas : une fatwa = question/exposé + réponse, souvent introduite
   par un numéro. Recopie le texte FIDÈLEMENT, sans résumer, sans traduire, sans corriger.
2. Si un FRAGMENT EN ATTENTE est fourni, sa suite est le début de la page : la fatwa
   reconstituée (fragment + suite) doit être la PREMIÈRE de fatwas_completes si elle se
   termine sur cette page, sinon elle reste dans fatwa_ouverte (texte_partiel cumulé).
3. Si la dernière fatwa de la page est coupée (réponse inachevée, phrase interrompue),
   mets-la dans fatwa_ouverte, pas dans fatwas_completes.
4. numero_fatwa : le numéro tel qu'imprimé (chiffres arabes acceptés), vide si absent.
5. sujet_principal / sous_sujet : thème fiqh court (mariage, zakat, prière…), déduis-les
   du contenu ; en arabe si le texte est en arabe.
6. Titres de chapitres, en-têtes, numéros de page isolés : à ignorer (ni fatwa ni fragment).
Réponds STRICTEMENT au schéma JSON demandé.`;

export interface StructurationInput {
  titreLivre: string;
  numeroPage: number;
  textePage: string;
  fragment: FatwaOuverteState | null;
}

export function buildStructurationPrompt(input: StructurationInput): string {
  const fragmentBloc = input.fragment
    ? `FRAGMENT EN ATTENTE (fatwa ${input.fragment.numero || 'sans numéro'} commencée sur les pages précédentes — le début de la page ci-dessous en est la suite) :
${input.fragment.textePartiel}

`
    : '';
  return `${fragmentBloc}TEXTE OCR DE LA PAGE ${input.numeroPage} DU LIVRE « ${input.titreLivre} » :
${input.textePage}`;
}

/** JSON.parse + validation zod, en snake_case Gemini → camelCase domaine. */
export function parseStructurationJson(raw: string): StructurationResult {
  const parsed = structurationSchema.parse(JSON.parse(stripJsonFences(raw)));
  return {
    fatwasCompletes: parsed.fatwas_completes.map((f) => ({
      numero: f.numero_fatwa.trim(),
      sujetPrincipal: f.sujet_principal.trim(),
      sousSujet: f.sous_sujet.trim(),
      texteComplet: f.texte_complet.trim(),
    })),
    fatwaOuverte: parsed.fatwa_ouverte
      ? {
          numero: parsed.fatwa_ouverte.numero_fatwa.trim(),
          sujetPrincipal: parsed.fatwa_ouverte.sujet_principal.trim(),
          sousSujet: parsed.fatwa_ouverte.sous_sujet.trim(),
          textePartiel: parsed.fatwa_ouverte.texte_partiel.trim(),
        }
      : null,
  };
}

export interface StructurationOptions extends GeminiCallOptions {
  model: string;
}

/** Structure une page ; un retry avec feedback si le JSON rendu est invalide. */
export async function geminiStructurePage(
  input: StructurationInput,
  opts: StructurationOptions,
): Promise<StructurationResult> {
  const prompt = buildStructurationPrompt(input);
  let derniereErreur = '';
  for (let essai = 0; essai < 2; essai++) {
    const texte =
      essai === 0
        ? prompt
        : `${prompt}

Ta réponse précédente était invalide (${derniereErreur}). Réponds STRICTEMENT au schéma JSON demandé.`;
    const raw = await geminiGenerateText(
      {
        model: opts.model,
        systemInstruction: STRUCTURATION_SYSTEM,
        contents: [{ role: 'user', parts: [{ text: texte }] }],
        responseSchema: STRUCTURATION_RESPONSE_SCHEMA,
      },
      opts,
    );
    try {
      return parseStructurationJson(raw);
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }
  throw new Error(`structuration invalide après 2 essais : ${derniereErreur}`);
}

/** Normalise un numéro de fatwa (chiffres arabes → latins, trim). */
export function normaliseNumeroFatwa(numero: string): string {
  return normalizeDigits(numero).trim();
}

/** Partie d'ID de document Firestore sûre (pas de /, espaces, etc.). */
export function sanitizeIdPart(value: string): string {
  return value
    .replace(/[/\s#?[\]]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 300);
}

/**
 * ID de document d'une fatwa : `{livreId}_{numéro normalisé}`.
 * La déduplication (ex-colonne A du MASTER_SHEET) devient l'ID lui-même.
 * Sans numéro exploitable, un suffixe déterministe (page + index) est utilisé.
 */
export function fatwaIdFrom(livreId: string, numeroBrut: string, fallbackSuffix: string): string {
  const numero = sanitizeIdPart(normaliseNumeroFatwa(numeroBrut));
  const part = numero !== '' ? numero : sanitizeIdPart(fallbackSuffix);
  return `${sanitizeIdPart(livreId)}_${part !== '' ? part : 'x'}`;
}
