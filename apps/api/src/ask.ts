import { randomUUID } from 'node:crypto';
import {
  type ApiConfig,
  type FatwaDoc,
  FieldValue,
  type GeminiContent,
  conversationRef,
  db,
  fatwasCol,
  gcsSignedReadUrl,
  geminiEmbedText,
  geminiGenerateText,
  livreRef,
  logger,
  messagesCol,
} from '@fataawa/core';
import {
  ANSWER_RESPONSE_SCHEMA,
  type AskRequest,
  type SourceFatwa,
  TRIAGE_RESPONSE_SCHEMA,
  askRequestSchema,
  buildContexte,
  filtreSources,
  groundingSystemPrompt,
  parseAnswer,
  parseTriage,
  triageSystemPrompt,
} from './rag.js';

/** Index vectoriel absent ou en cours de création (FAILED_PRECONDITION). */
export class VectorIndexError extends Error {
  constructor(cause: string) {
    super(`index vectoriel indisponible : ${cause}`);
    this.name = 'VectorIndexError';
  }
}

export interface AskSourceOut {
  numero_fatwa: string;
  citation_arabe: string;
  livre_titre: string;
  numero_page: number | null;
  url_image: string | null;
}

export interface AskAnswerOut {
  type: 'reponse';
  conversationId: string;
  reponse_utilisateur: string;
  suggestions_cliquables: string[];
  sources_utilisees: AskSourceOut[];
}

/** La question est ambiguë : on demande confirmation avant de chercher. */
export interface AskClarificationOut {
  type: 'clarification';
  conversationId: string;
  message: string;
  question_proposee: string;
  autres_interpretations: string[];
}

export type AskResult = AskAnswerOut | AskClarificationOut;

interface MessageDoc {
  role: 'user' | 'assistant';
  texte: string;
}

const CLARIFICATION_PAR_DEFAUT: Record<AskRequest['langue'], string> = {
  fr: 'Votre question est-elle bien celle-ci ?',
  en: 'Is this your question?',
  ar: 'هل سؤالك هو التالي؟',
};

async function persistExchange(
  conversationId: string,
  langue: AskRequest['langue'],
  userTexte: string,
  assistantTexte: string,
  isNew: boolean,
): Promise<void> {
  const now = Date.now();
  const batch = db().batch();
  batch.set(
    conversationRef(conversationId),
    {
      langue,
      majAt: FieldValue.serverTimestamp(),
      ...(isNew ? { creeAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );
  batch.set(messagesCol(conversationId).doc(), {
    role: 'user',
    texte: userTexte,
    ordre: now,
    at: FieldValue.serverTimestamp(),
  });
  batch.set(messagesCol(conversationId).doc(), {
    role: 'assistant',
    texte: assistantTexte,
    ordre: now + 1,
    at: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

export async function handleAsk(cfg: ApiConfig, body: unknown): Promise<AskResult> {
  const req = askRequestSchema.parse(body);
  const conversationId = req.conversationId ?? randomUUID();

  // historique (conversation continue, N derniers tours)
  const histSnap =
    cfg.historyTurns > 0
      ? await messagesCol(conversationId)
          .orderBy('ordre', 'desc')
          .limit(cfg.historyTurns * 2)
          .get()
      : null;
  const history = (histSnap?.docs ?? [])
    .map((d) => d.data() as MessageDoc)
    .reverse();
  const historyContents: GeminiContent[] = history.map(
    (m): GeminiContent => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.texte }],
    }),
  );

  // triage : Gemini lit la question avant toute recherche. Claire → recherche
  // directe (avec la reformulation autonome). Ambiguë → demande de confirmation.
  // Sauté quand l'utilisateur vient de confirmer une question proposée.
  let questionRecherche = req.question;
  if (!req.questionConfirmee) {
    try {
      const raw = await geminiGenerateText(
        {
          model: cfg.geminiModel,
          systemInstruction: triageSystemPrompt(req.langue),
          contents: [
            ...historyContents,
            { role: 'user', parts: [{ text: `QUESTION À ANALYSER : ${req.question}` }] },
          ],
          responseSchema: TRIAGE_RESPONSE_SCHEMA,
          temperature: 0,
        },
        { apiKey: cfg.geminiApiKey },
      );
      const triage = parseTriage(raw);
      if (triage.statut === 'AMBIGUE') {
        const message = triage.message_clarification || CLARIFICATION_PAR_DEFAUT[req.langue];
        await persistExchange(
          conversationId,
          req.langue,
          req.question,
          `${message} « ${triage.question_autonome} »`,
          history.length === 0,
        );
        return {
          type: 'clarification',
          conversationId,
          message,
          question_proposee: triage.question_autonome,
          autres_interpretations: triage.autres_interpretations,
        };
      }
      if (triage.question_autonome.trim() !== '') {
        questionRecherche = triage.question_autonome.trim();
      }
    } catch (err) {
      // jamais bloquant : en cas d'échec du triage on cherche avec la question brute
      logger.warn({ err }, 'triage en échec, recherche avec la question originale');
    }
  }

  // retrieval : embedding de la question (résolue) puis KNN Firestore
  const qVector = await geminiEmbedText(
    questionRecherche,
    { model: cfg.embeddingModel, dim: cfg.embeddingDim, taskType: 'RETRIEVAL_QUERY' },
    { apiKey: cfg.geminiApiKey },
  );
  let sources: SourceFatwa[];
  try {
    const snap = await fatwasCol()
      .findNearest('embedding', qVector, { limit: cfg.topK, distanceMeasure: 'COSINE' })
      .get();
    sources = snap.docs.map((d) => {
      const f = d.data() as FatwaDoc;
      return {
        id: d.id,
        livreId: f.livreId,
        numero: f.numero ?? '',
        sujetPrincipal: f.sujetPrincipal ?? '',
        sousSujet: f.sousSujet ?? '',
        texteComplet: f.texteComplet ?? '',
        pages: f.pages ?? [],
      };
    });
  } catch (err) {
    if ((err as { code?: number }).code === 9) {
      throw new VectorIndexError('lancer infra/setup.sh (index fatwas/embedding)');
    }
    throw err;
  }

  // génération groundée, avec l'historique de conversation
  const contents: GeminiContent[] = [
    ...historyContents,
    {
      role: 'user',
      parts: [
        {
          text: `${buildContexte(sources)}

QUESTION (langue de réponse : ${req.langue}) : ${questionRecherche}`,
        },
      ],
    },
  ];
  const raw = await geminiGenerateText(
    {
      model: cfg.geminiModel,
      systemInstruction: groundingSystemPrompt(req.langue),
      contents,
      responseSchema: ANSWER_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
    { apiKey: cfg.geminiApiKey },
  );
  const answer = parseAnswer(raw);
  const utilisees = filtreSources(answer, sources);

  // enrichissement des sources : titre du livre + URL signée de la page scannée
  const titres = new Map<string, string>();
  for (const livreId of new Set(utilisees.map((u) => u.source.livreId).filter(Boolean))) {
    const snap = await livreRef(livreId).get();
    titres.set(livreId, snap.exists ? ((snap.data() as { titre?: string }).titre ?? '') : '');
  }
  const sourcesOut: AskSourceOut[] = await Promise.all(
    utilisees.map(async (u) => {
      const page = u.source.pages[0];
      let url: string | null = null;
      if (page) {
        try {
          url = await gcsSignedReadUrl(cfg.gcsBucket, page.gcsPath, cfg.signedUrlTtlMinutes);
        } catch (err) {
          logger.warn({ err, gcsPath: page.gcsPath }, 'signature URL image en échec');
        }
      }
      return {
        numero_fatwa: u.numeroFatwa,
        citation_arabe: u.citationArabe,
        livre_titre: titres.get(u.source.livreId) ?? '',
        numero_page: page?.numero ?? null,
        url_image: url,
      };
    }),
  );

  await persistExchange(
    conversationId,
    req.langue,
    req.question,
    answer.reponse_utilisateur,
    history.length === 0,
  );

  return {
    type: 'reponse',
    conversationId,
    reponse_utilisateur: answer.reponse_utilisateur,
    suggestions_cliquables: answer.suggestions_cliquables,
    sources_utilisees: sourcesOut,
  };
}
