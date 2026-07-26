import { z } from 'zod';
import { type Fatwa, stripJsonFences } from '@fataawa/core';

/** Fatwa candidate issue du vector search. */
export type SourceFatwa = Fatwa;

const MAX_CHARS_PAR_BLOC = 4000;

/** Blocs SOURCE_BLOC_i injectés dans le prompt (format hérité du GAS). */
export function buildContexte(sources: SourceFatwa[]): string {
  if (sources.length === 0) return 'AUCUNE SOURCE DISPONIBLE.';
  return sources
    .map((s, i) => {
      const sujet = [s.sujetPrincipal, s.sousSujet].filter(Boolean).join(' / ');
      return `SOURCE_BLOC_${i + 1}
fatwa_id: ${s.id}
numero_fatwa: ${s.numero || '—'}
sujet: ${sujet || '—'}
texte:
${s.texte.slice(0, MAX_CHARS_PAR_BLOC)}
---`;
    })
    .join('\n');
}

export const askRequestSchema = z.object({
  // 500 caractères : une question, pas un texte à commenter. Le front applique
  // la même borne, celle-ci la garantit quel que soit le client.
  question: z.string().trim().min(2).max(500),
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,128}$/)
    .optional(),
  langue: z.enum(['fr', 'en', 'ar']).default('fr'),
  /** true quand l'utilisateur a confirmé une question proposée : le triage est sauté. */
  questionConfirmee: z.boolean().default(false),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

const answerSchema = z.object({
  reponse_utilisateur: z.string().min(1),
  suggestions_cliquables: z.array(z.string()).max(6).default([]),
  sources_utilisees: z
    .array(
      z.object({
        fatwa_id: z.string().default(''),
        numero_fatwa: z.string().default(''),
        citation_arabe: z.string().default(''),
      }),
    )
    .default([]),
});
export type AskAnswer = z.infer<typeof answerSchema>;

/** Schéma de réponse au format Gemini (responseSchema). */
export const ANSWER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reponse_utilisateur: { type: 'STRING' },
    suggestions_cliquables: { type: 'ARRAY', items: { type: 'STRING' } },
    sources_utilisees: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          fatwa_id: { type: 'STRING' },
          numero_fatwa: { type: 'STRING' },
          citation_arabe: { type: 'STRING' },
        },
        required: ['fatwa_id'],
      },
    },
  },
  required: ['reponse_utilisateur'],
} as const;

const LANGUE_REPONSE: Record<AskRequest['langue'], string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

// ─────────────────────── triage de clarté (avant recherche) ───────────────────────

export const TRIAGE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    statut: { type: 'STRING', enum: ['CLAIRE', 'AMBIGUE'] },
    question_autonome: { type: 'STRING' },
    message_clarification: { type: 'STRING' },
    autres_interpretations: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['statut', 'question_autonome'],
} as const;

const triageSchema = z.object({
  statut: z.enum(['CLAIRE', 'AMBIGUE']),
  question_autonome: z.string().min(1),
  message_clarification: z.string().default(''),
  autres_interpretations: z.array(z.string()).max(3).default([]),
});
export type TriageResult = z.infer<typeof triageSchema>;

export function parseTriage(raw: string): TriageResult {
  return triageSchema.parse(JSON.parse(stripJsonFences(raw)));
}

/**
 * Lit la question avant toute recherche : claire → on cherche directement
 * (avec une reformulation autonome qui résout les références à l'historique) ;
 * ambiguë → on renvoie une demande de confirmation à l'utilisateur.
 */
export function triageSystemPrompt(langue: AskRequest['langue']): string {
  return `Tu es le filtre d'entrée d'un moteur de recherche dans des recueils de fatwas.
On te donne l'éventuel historique de conversation puis la dernière question de l'utilisateur.
Ta mission :
1. question_autonome : reformule la question en UNE question autonome et précise, en
   résolvant les références à l'historique (« et pour les femmes ? » devient une question
   complète). Elle sert à la recherche documentaire : conserve tous les termes importants,
   dans la langue de l'utilisateur.
2. statut = "CLAIRE" si un lecteur comprend sans hésiter ce qui est demandé — c'est le
   cas de la grande majorité des questions, même familières ou mal orthographiées.
   Choisis "AMBIGUE" UNIQUEMENT si la question est réellement équivoque : trop vague
   (« c'est permis ? » sans sujet), plusieurs sens incompatibles, référence introuvable
   dans l'historique, ou question incompréhensible.
3. Si AMBIGUE : message_clarification = une phrase courte en ${LANGUE_REPONSE[langue]}
   qui demande confirmation (du type « Votre question est-elle bien celle-ci ? ») ;
   question_autonome = l'interprétation la plus probable ; autres_interpretations =
   0 à 3 lectures alternatives plausibles, chacune formulée comme une question complète.
Réponds STRICTEMENT au schéma JSON demandé.`;
}

/** System prompt de grounding strict (hérité du front GAS, exécuté côté API). */
export function groundingSystemPrompt(langue: AskRequest['langue']): string {
  return `Tu es l'assistant du recueil de fatwas « Fataawa ».
RÈGLES ABSOLUES :
1. Tu réponds UNIQUEMENT à partir des blocs SOURCE_BLOC fournis dans le message.
   Aucune connaissance externe, aucune fatwa inventée, aucun avis personnel.
2. Si les sources ne permettent pas de répondre, dis-le honnêtement et propose des
   reformulations de la question.
3. Réponse rédigée en ${LANGUE_REPONSE[langue]}. Les citations arabes restent en arabe,
   exactes, recopiées mot pour mot depuis les sources.
4. Tu rapportes ce que disent les fatwas citées, avec leur numéro quand il existe.
5. suggestions_cliquables : 2 à 4 questions de suivi courtes, dans la langue de la
   réponse, auxquelles le corpus peut répondre.
6. sources_utilisees : uniquement les blocs réellement utilisés, avec le fatwa_id EXACT
   du bloc et une courte citation arabe exacte.
Réponds STRICTEMENT au schéma JSON demandé.`;
}

/** JSON.parse + validation zod de la réponse du modèle. */
export function parseAnswer(raw: string): AskAnswer {
  return answerSchema.parse(JSON.parse(stripJsonFences(raw)));
}

export interface SourceUtilisee {
  source: SourceFatwa;
  numeroFatwa: string;
  citationArabe: string;
}

/**
 * Ne garde que les sources citées qui existent vraiment dans le lot récupéré
 * (par fatwa_id, sinon par numéro) — le modèle ne peut pas inventer de source.
 */
export function filtreSources(
  answer: AskAnswer,
  sources: SourceFatwa[],
): SourceUtilisee[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const byNumero = new Map(
    sources.filter((s) => s.numero !== '').map((s) => [s.numero, s]),
  );
  const vues = new Set<string>();
  const resultat: SourceUtilisee[] = [];
  for (const citation of answer.sources_utilisees) {
    const source = byId.get(citation.fatwa_id) ?? byNumero.get(citation.numero_fatwa);
    if (!source || vues.has(source.id)) continue;
    vues.add(source.id);
    resultat.push({
      source,
      numeroFatwa: source.numero || citation.numero_fatwa,
      citationArabe: citation.citation_arabe,
    });
  }
  return resultat;
}
