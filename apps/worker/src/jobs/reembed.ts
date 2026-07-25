import { z } from 'zod';
import {
  CHAMP_EMBEDDING_ACTUEL,
  FieldValue,
  type FatwaStored,
  fatwasCol,
  geminiEmbedText,
  logger,
  texteAEmbedder,
  toFatwa,
} from '@fataawa/core';

/**
 * Ré-embedding de la collection historique `fatawas_db`.
 *
 * Les vecteurs du champ `embedding` ont été produits par un modèle retiré de
 * l'API Gemini : ils sont inexploitables avec `gemini-embedding-001`
 * (similarité mesurée ≈ 0,04 pour un même texte). Ce job recalcule chaque
 * vecteur dans `embedding_v2` sans jamais toucher au champ historique.
 *
 * Idempotent et reprenable : un document dont `embedding_model` correspond
 * déjà au modèle courant est ignoré, sauf FORCE=1.
 *
 * Exécuté comme Cloud Run Job (infra/run-reembed.sh).
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  EMBEDDING_DIM: z.coerce.number().int().min(64).max(2048).default(768),
  PAGE_SIZE: z.coerce.number().int().min(10).max(1000).default(300),
  CONCURRENCY: z.coerce.number().int().min(1).max(16).default(6),
  LIMIT: z.coerce.number().int().min(0).default(0),
  FORCE: z.string().optional(),
});

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const cfg = configSchema.parse(process.env);
  const force = cfg.FORCE === '1' || cfg.FORCE === 'true';
  let cursor: string | undefined;
  let vus = 0;
  let indexes = 0;
  let ignores = 0;
  let erreurs = 0;

  logger.info(
    { modele: cfg.EMBEDDING_MODEL, dim: cfg.EMBEDDING_DIM, force, champ: CHAMP_EMBEDDING_ACTUEL },
    'ré-embedding démarré',
  );

  for (;;) {
    // projection : on ne rapatrie ni le vecteur historique ni les champs inutiles
    let query = fatwasCol()
      .orderBy('__name__')
      .select('texte_arabe', 'sujet_principal', 'sous_sujet', 'embedding_model')
      .limit(cfg.PAGE_SIZE);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    cursor = snap.docs[snap.docs.length - 1]?.ref.path;

    const aTraiter = snap.docs.filter((doc) => {
      const data = doc.data() as FatwaStored;
      if (!force && data.embedding_model === cfg.EMBEDDING_MODEL) return false;
      return texteAEmbedder(toFatwa(doc.id, data)).trim() !== '';
    });
    ignores += snap.size - aTraiter.length;
    vus += snap.size;

    await mapWithConcurrency(aTraiter, cfg.CONCURRENCY, async (doc) => {
      const texte = texteAEmbedder(toFatwa(doc.id, doc.data() as FatwaStored));
      try {
        const vecteur = await geminiEmbedText(
          texte,
          {
            model: cfg.EMBEDDING_MODEL,
            dim: cfg.EMBEDDING_DIM,
            taskType: 'RETRIEVAL_DOCUMENT',
          },
          { apiKey: cfg.GEMINI_API_KEY },
        );
        await doc.ref.update({
          [CHAMP_EMBEDDING_ACTUEL]: FieldValue.vector(vecteur),
          embedding_model: cfg.EMBEDDING_MODEL,
          statut: 'EN_LIGNE',
          majAt: FieldValue.serverTimestamp(),
        });
        indexes++;
      } catch (err) {
        erreurs++;
        logger.error({ fatwaId: doc.id, err }, 'ré-embedding en échec pour cette fatwa');
      }
    });

    logger.info({ vus, indexes, ignores, erreurs }, 'ré-embedding en cours…');
    if (cfg.LIMIT > 0 && indexes >= cfg.LIMIT) {
      logger.info({ limite: cfg.LIMIT }, 'limite atteinte, arrêt');
      break;
    }
    if (snap.size < cfg.PAGE_SIZE) break;
  }

  logger.info({ vus, indexes, ignores, erreurs }, 'ré-embedding terminé');
  if (erreurs > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  logger.error({ err }, 'ré-embedding en échec');
  process.exitCode = 1;
});
