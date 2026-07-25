import { Router } from 'express';
import {
  FieldValue,
  type FatwaDoc,
  type WorkerConfig,
  embedTaskPayloadSchema,
  fatwaRef,
  geminiEmbedText,
  logger,
} from '@fataawa/core';
import { asyncHandler, errorMessage } from '../util.js';

/**
 * POST /tasks/embed — déclenché après chaque écriture de fatwa (queue
 * « embedding »). Calcule le vecteur (sujet + texte) et passe la fatwa
 * EN_LIGNE. Idempotent : recalculer un embedding est sans effet de bord.
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
      const fatwa = snap.data() as FatwaDoc;
      const texte = [fatwa.sujetPrincipal, fatwa.sousSujet, fatwa.texteComplet]
        .filter(Boolean)
        .join('\n');

      try {
        const vecteur = await geminiEmbedText(
          texte,
          { model: cfg.embeddingModel, dim: cfg.embeddingDim, taskType: 'RETRIEVAL_DOCUMENT' },
          { apiKey: cfg.geminiApiKey },
        );
        await ref.update({
          embedding: FieldValue.vector(vecteur),
          embeddingModel: cfg.embeddingModel,
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
