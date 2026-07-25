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
  /** Repère de sous-question dans une même fatwa : « 1 », « 2 », « أ »… vide si unique. */
  sousQuestion: string;
  sujetPrincipal: string;
  sousSujet: string;
  question: string;
  reponse: string;
  texteComplet: string;
}

export interface FragmentOuvert {
  numero: string;
  sousQuestion: string;
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
  sous_question: z.string().default(''),
  sujet_principal: z.string().default(''),
  sous_sujet: z.string().default(''),
  question: z.string().default(''),
  reponse: z.string().default(''),
  texte_complet: z.string().min(1),
});

const structurationSchema = z.object({
  fatwas_completes: z.array(fatwaExtraiteSchema).default([]),
  fatwa_ouverte: z
    .object({
      numero_fatwa: z.string().default(''),
      sous_question: z.string().default(''),
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
          sous_question: { type: 'STRING' },
          sujet_principal: { type: 'STRING' },
          sous_sujet: { type: 'STRING' },
          question: { type: 'STRING' },
          reponse: { type: 'STRING' },
          texte_complet: { type: 'STRING' },
        },
        // question et réponse sont exigées : sans elles, impossible de savoir
        // où s'arrête l'exposé et où commence la réponse du comité
        required: ['question', 'reponse', 'texte_complet'],
      },
    },
    fatwa_ouverte: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        numero_fatwa: { type: 'STRING' },
        sous_question: { type: 'STRING' },
        sujet_principal: { type: 'STRING' },
        sous_sujet: { type: 'STRING' },
        texte_partiel: { type: 'STRING' },
      },
      required: ['texte_partiel'],
    },
  },
  required: ['fatwas_completes'],
} as const;

export const STRUCTURATION_SYSTEM = `Tu structures des recueils de fatwas arabes en parcourant le livre dans l'ordre.

Tu reçois une FENÊTRE DE LECTURE de plusieurs pages consécutives :
- la PAGE COURANTE, seule page dont tu extrais les fatwas ;
- des PAGES SUIVANTES fournies uniquement comme CONTEXTE, pour que tu puisses voir où
  se termine une fatwa qui déborde de la page courante ;
- éventuellement un FRAGMENT EN ATTENTE : une fatwa commencée avant la page courante,
  dont le début de la page courante est la suite.

Règles strictes :
1. N'extrais QUE les fatwas qui commencent dans la PAGE COURANTE, ou qui prolongent le
   FRAGMENT EN ATTENTE. Une fatwa qui commence dans une page de contexte ne doit PAS
   être extraite : elle le sera à son tour. C'est ce qui évite les doublons.
2. Une fatwa peut se poursuivre dans les pages de contexte : dans ce cas recopie son
   texte ENTIER (page courante + suite) et place-la dans fatwas_completes. Ne coupe
   jamais une fatwa au bord d'une page.
3. Si une fatwa commencée dans la page courante n'est toujours pas terminée à la fin de
   la fenêtre, mets-la dans fatwa_ouverte (texte_partiel cumulé) et non dans
   fatwas_completes.
4. Recopie le texte arabe FIDÈLEMENT : ni résumé, ni traduction, ni correction.
5. numero_fatwa : le numéro de la fatwa tel qu'imprimé (chiffres arabes acceptés), vide
   s'il n'y en a pas. Ce numéro appartient souvent à un en-tête du type
   « السؤال الأول من الفتوى رقم (1881) » : le nombre entre parenthèses est le numéro.
6. SOUS-QUESSTIONS : une même fatwa contient parfois plusieurs questions
   (« السؤال الأول », « السؤال الثاني », ou des repères أ / ب / ج, ou 1 / 2 / 3), chacune
   avec sa propre réponse. Produis alors UNE ENTRÉE PAR QUESTION, toutes avec le MÊME
   numero_fatwa, et renseigne sous_question avec le repère tel qu'imprimé (« الأول »,
   « أ », « 2 »…). Si la fatwa ne contient qu'une question, laisse sous_question vide.
7. question / reponse : OBLIGATOIRES et jamais vides. Sépare l'exposé du demandeur de la
   réponse du comité. La réponse commence à son marqueur imprimé — « الجواب »,
   « وبعد », « الحمد لله » — ou, à défaut de marqueur, à la première phrase qui répond.
   texte_complet : les deux réunis, dans l'ordre de lecture, sans rien retirer.
8. sujet_principal / sous_sujet : thème de fiqh court (الزكاة، الصلاة، النكاح…), déduit de
   la fatwa ENTIÈRE — jamais du seul début ni de la seule fin — en arabe si le texte
   l'est. Deux entrées d'une même fatwa peuvent avoir des sujets différents.
9. Ignore les titres de chapitres, en-têtes courants, numéros de page isolés et notes de
   bas de page : ce ne sont ni des fatwas ni des fragments.
Réponds STRICTEMENT au schéma JSON demandé.`;

export interface PageFenetre {
  numero: number;
  texte: string;
}

export interface StructurationInput {
  titreLivre: string;
  numeroPage: number;
  textePage: string;
  /** Pages suivantes fournies comme contexte de fin de fatwa. */
  pagesSuivantes?: PageFenetre[];
  fragment: FatwaOuverteState | null;
}

export function buildStructurationPrompt(input: StructurationInput): string {
  const fragmentBloc = input.fragment
    ? `FRAGMENT EN ATTENTE — fatwa ${input.fragment.numero || 'sans numéro'}${
        input.fragment.sousQuestion ? `, question ${input.fragment.sousQuestion}` : ''
      } commencée avant la page courante ; le début de la page courante en est la suite :
${input.fragment.textePartiel}

`
    : '';
  const contexte = (input.pagesSuivantes ?? [])
    .map(
      (p) => `--- PAGE ${p.numero} (CONTEXTE, ne pas extraire ce qui y commence) ---
${p.texte}`,
    )
    .join('\n\n');
  return `${fragmentBloc}=== PAGE COURANTE ${input.numeroPage} — LIVRE « ${input.titreLivre} » ===
${input.textePage}${contexte === '' ? '' : `\n\n${contexte}`}`;
}

/** JSON.parse + validation zod, en snake_case Gemini → camelCase domaine. */
export function parseStructurationJson(raw: string): StructurationResult {
  const parsed = structurationSchema.parse(JSON.parse(stripJsonFences(raw)));
  return {
    fatwasCompletes: parsed.fatwas_completes.map((f) => ({
      numero: f.numero_fatwa.trim(),
      sousQuestion: f.sous_question.trim(),
      sujetPrincipal: f.sujet_principal.trim(),
      sousSujet: f.sous_sujet.trim(),
      question: f.question.trim(),
      reponse: f.reponse.trim(),
      texteComplet: f.texte_complet.trim(),
    })),
    fatwaOuverte: parsed.fatwa_ouverte
      ? {
          numero: parsed.fatwa_ouverte.numero_fatwa.trim(),
          sousQuestion: parsed.fatwa_ouverte.sous_question.trim(),
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

/**
 * Repères de sous-question tels qu'imprimés dans les recueils, ramenés à un
 * rang numérique. Sans cette normalisation, la même question extraite deux
 * fois avec deux écritures différentes (« الثاني » puis « 2 ») produirait deux
 * documents au lieu d'un. Le repère d'origine reste lisible dans le texte de
 * la fatwa.
 */
const RANGS_ARABES: Record<string, number> = {
  // ordinaux
  الأول: 1, الاول: 1, الثاني: 2, الثانى: 2, الثالث: 3, الرابع: 4, الخامس: 5,
  السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10,
  // lettres de l'abjad utilisées comme puces
  أ: 1, ا: 1, ب: 2, ج: 3, د: 4, ه: 5, و: 6, ز: 7, ح: 8, ط: 9, ي: 10,
};

export function normaliseSousQuestion(brut: string): string {
  const nettoye = normalizeDigits(brut)
    .replace(/[()[\].:،,-]/g, ' ')
    .trim();
  if (nettoye === '') return '';
  const chiffres = nettoye.match(/\d+/);
  if (chiffres?.[0]) return String(Number.parseInt(chiffres[0], 10));
  for (const mot of nettoye.split(/\s+/)) {
    const rang = RANGS_ARABES[mot];
    if (rang !== undefined) return String(rang);
  }
  // repère non reconnu : conservé tel quel plutôt que perdu
  return sanitizeIdPart(nettoye);
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
 * ID de document d'une fatwa : `{livreId}_{numéro}` — plus `_{sous-question}`
 * quand la fatwa porte plusieurs questions. L'ID EST la déduplication :
 * réécrire la même fatwa (page rejouée, structuration relancée) écrase le même
 * document au lieu d'en créer un second.
 * Sans numéro exploitable, un suffixe déterministe (page + index) est utilisé.
 */
export function fatwaIdFrom(
  livreId: string,
  numeroBrut: string,
  fallbackSuffix: string,
  sousQuestion = '',
): string {
  const numero = sanitizeIdPart(normaliseNumeroFatwa(numeroBrut));
  const part = numero !== '' ? numero : sanitizeIdPart(fallbackSuffix);
  const sous = normaliseSousQuestion(sousQuestion);
  return `${sanitizeIdPart(livreId)}_${part !== '' ? part : 'x'}${sous !== '' ? `_${sous}` : ''}`;
}
