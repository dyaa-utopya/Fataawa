import { Router } from 'express';
import { z } from 'zod';
import {
  type FatwaStored,
  type WorkerConfig,
  enqueueWorkerTask,
  fatwasCol,
  logger,
  texteAEmbedder,
  toFatwa,
} from '@fataawa/core';
import { asyncHandler, tasksRuntime } from '../util.js';

const payloadSchema = z.object({
  /** Chemin du dernier document traité (pagination reprenable). */
  cursor: z.string().optional(),
  /** Ré-embedde même les fatwas déjà à jour. */
  force: z.boolean().default(false),
});

const DOCS_PAR_PASSAGE = 500;

/**
 * POST /tasks/reembed — (ré)indexation de la collection de fatwas.
 *
 * Parcourt `fatawas_db` par pages et enfile une tâche `/tasks/embed` pour
 * chaque fatwa dont le vecteur n'est pas à jour, puis se ré-enfile avec le
 * curseur suivant. C'est la queue `embedding` qui porte le débit et les
 * retries. Idempotent : relancer ne fait que re-vérifier.
 *
 * Utilisé pour le rattrapage initial (les vecteurs historiques viennent d'un
 * modèle retiré de l'API) et après tout changement de modèle d'embedding.
 */
export function reembedRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/reembed',
    asyncHandler(async (req, res) => {
      const parsed = payloadSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        logger.error({ body: req.body }, 'payload reembed invalide, tâche abandonnée');
        res.status(200).json({ ignoree: 'payload invalide' });
        return;
      }
      const { cursor, force } = parsed.data;

      let query = fatwasCol()
        .orderBy('__name__')
        .select('texte_arabe', 'sujet_principal', 'sous_sujet', 'embedding_model')
        .limit(DOCS_PAR_PASSAGE);
      // ordonné par __name__ : le curseur est l'ID nu du document, pas son chemin
      if (cursor !== undefined) query = query.startAfter(cursor);
      const snap = await query.get();

      let enfilees = 0;
      let ignorees = 0;
      for (const doc of snap.docs) {
        const data = doc.data() as FatwaStored;
        const aJour = data.embedding_model === cfg.embeddingModel;
        const sansTexte = texteAEmbedder(toFatwa(doc.id, data)).trim() === '';
        if ((aJour && !force) || sansTexte) {
          ignorees++;
          continue;
        }
        await enqueueWorkerTask(tasksRuntime(cfg), cfg.embedQueue, '/tasks/embed', {
          fatwaId: doc.id,
        });
        enfilees++;
      }

      const suite = snap.size === DOCS_PAR_PASSAGE ? snap.docs[snap.size - 1]?.id : undefined;
      if (suite !== undefined) {
        await enqueueWorkerTask(tasksRuntime(cfg), cfg.embedQueue, '/tasks/reembed', {
          cursor: suite,
          force,
        });
      }

      logger.info({ vus: snap.size, enfilees, ignorees, reste: suite !== undefined }, 'ré-embedding : lot traité');
      res.status(200).json({ vus: snap.size, enfilees, ignorees, termine: suite === undefined });
    }),
  );

  return router;
}
