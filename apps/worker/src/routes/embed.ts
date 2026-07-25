import { Router } from 'express';
import {
  CHAMP_EMBEDDING_ACTUEL,
  FieldValue,
  type FatwaStored,
  type WorkerConfig,
  embedTaskPayloadSchema,
  fatwaRef,
  geminiEmbedText,
  logger,
  texteAEmbedder,
  toFatwa,
} from '@fataawa/core';
import { asyncHandler, errorMessage } from '../util.js';

/**
 * POST /tasks/embed — déclenché après chaque écriture de fatwa (queue
 * « embedding ») et par le job de ré-embedding. Écrit le vecteur dans
 * `embedding_v2` (le champ historique `embedding`, produit par un modèle
 * retiré, reste intact) et passe la fatwa EN_LIGNE. Idempotent.
 */
export function embedRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/embed',
    asyncHandler(async (req, res) => {
      const parsed = embedTaskPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.error({ body: req.body }, 'payload embed invalide, tâche abandonnée');
        res.status(200).json({ ignoree: 'payload invalide' });
        return;
      }
      const { fatwaId } = parsed.data;
      const log = logger.child({ fatwaId });

      const ref = fatwaRef(fatwaId);
      const snap = await ref.get();
      if (!snap.exists) {
        log.warn('fatwa absente, tâche abandonnée');
        res.status(200).json({ ignoree: 'fatwa absente' });
        return;
      }
      const texte = texteAEmbedder(toFatwa(snap.id, snap.data() as FatwaStored));
      if (texte.trim() === '') {
        log.warn('fatwa sans texte, embedding ignoré');
        res.status(200).json({ ignoree: 'texte vide' });
        return;
      }

      try {
        const vecteur = await geminiEmbedText(
          texte,
          { model: cfg.embeddingModel, dim: cfg.embeddingDim, taskType: 'RETRIEVAL_DOCUMENT' },
          { apiKey: cfg.geminiApiKey },
        );
        await ref.update({
          [CHAMP_EMBEDDING_ACTUEL]: FieldValue.vector(vecteur),
          embedding_model: cfg.embeddingModel,
          statut: 'EN_LIGNE',
          majAt: FieldValue.serverTimestamp(),
        });
        log.info({ dim: vecteur.length }, 'fatwa indexée (EN_LIGNE)');
        res.status(200).json({ ok: true });
      } catch (err) {
        log.warn({ err }, `embedding en échec : ${errorMessage(err)}, retry via Cloud Tasks`);
        res.status(503).json({ retry: true });
      }
    }),
  );

  return router;
}
