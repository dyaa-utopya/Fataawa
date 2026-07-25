import { z } from 'zod';
import { type PageSourceRef, stripJsonFences } from '@fataawa/core';

/** Fatwa candidate issue du vector search, projetée pour le RAG. */
export interface SourceFatwa {
  id: string;
  livreId: string;
  numero: string;
  sujetPrincipal: string;
  sousSujet: string;
  texteComplet: string;
  pages: PageSourceRef[];
}

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
${s.texteComplet.slice(0, MAX_CHARS_PAR_BLOC)}
---`;
    })
    .join('\n');
}

export const askRequestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  conversationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,128}$/)
    .optional(),
  langue: z.enum(['fr', 'en', 'ar']).default('fr'),
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
