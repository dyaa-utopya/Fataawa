import { randomUUID } from 'node:crypto';
import {
  type ApiConfig,
  CHAMP_EMBEDDING_ACTUEL,
  type FatwaStored,
  FieldValue,
  type GeminiContent,
  conversationRef,
  db,
  fatwasCol,
  gcsExists,
  gcsSignedReadUrl,
  geminiEmbedText,
  geminiGenerateText,
  livreRef,
  logger,
  messagesCol,
  toFatwa,
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

/**
 * URL signée du scan d'une fatwa. Deux cas : fatwa du pipeline (chemin GCS
 * connu) ou fatwa historique, dont on ne connaît que le nom de fichier du
 * scan — on le cherche alors sous LEGACY_IMAGE_PREFIX et on ne signe que si
 * l'objet existe réellement (tant que les scans n'ont pas été déposés dans le
 * bucket, la source s'affiche simplement sans image).
 */
async function urlImage(cfg: ApiConfig, fatwa: SourceFatwa): Promise<string | null> {
  const chemin = fatwa.pages[0]?.gcsPath;
  try {
    if (chemin) {
      return await gcsSignedReadUrl(cfg.gcsBucket, chemin, cfg.signedUrlTtlMinutes);
    }
    if (fatwa.imageSource !== '') {
      const legacy = `${cfg.legacyImagePrefix}${fatwa.imageSource}`;
      if (await gcsExists(cfg.gcsBucket, legacy)) {
        return await gcsSignedReadUrl(cfg.gcsBucket, legacy, cfg.signedUrlTtlMinutes);
      }
    }
  } catch (err) {
    logger.warn({ err, fatwaId: fatwa.id }, 'résolution de l’image source en échec');
  }
  return null;
}

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
      .findNearest(CHAMP_EMBEDDING_ACTUEL, qVector, {
        limit: cfg.topK,
        distanceMeasure: 'COSINE',
      })
      .get();
    sources = snap.docs.map((d) => toFatwa(d.id, d.data() as FatwaStored));
  } catch (err) {
    if ((err as { code?: number }).code === 9) {
      throw new VectorIndexError(
        `index vectoriel sur fatawas_db.${CHAMP_EMBEDDING_ACTUEL} absent ou en construction`,
      );
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
      return {
        numero_fatwa: u.numeroFatwa,
        citation_arabe: u.citationArabe,
        livre_titre: titres.get(u.source.livreId) ?? '',
        numero_page: page?.numero ?? u.source.numeroPage,
        url_image: await urlImage(cfg, u.source),
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
