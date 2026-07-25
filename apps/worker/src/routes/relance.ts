import { Router } from 'express';
import {
  FieldValue,
  type PageDoc,
  STATUT_OCR,
  Timestamp,
  type WorkerConfig,
  enqueueWorkerTask,
  fatwasCol,
  livresCol,
  logger,
  pagesGroup,
} from '@fataawa/core';
import { asyncHandler, tasksRuntime } from '../util.js';

const MAX_RELANCES_PAR_PASSAGE = 200;
const MAX_LIVRES_PAR_PASSAGE = 50;
const MAX_EMBEDDINGS_PAR_PASSAGE = 100;

/**
 * POST /tasks/relance — balayage horaire (Cloud Scheduler). Filet de
 * sécurité : ré-enfile les pages OCR bloquées, réveille la structuration de
 * chaque livre en cours (le bail absorbe les doublons) et rattrape les
 * fatwas restées sans embedding. Tout est idempotent.
 */
export function relanceRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/relance',
    asyncHandler(async (_req, res) => {
      const rt = tasksRuntime(cfg);
      const cutoff = Timestamp.fromMillis(Date.now() - cfg.stuckAfterMinutes * 60_000);
      let pagesRelancees = 0;

      for (const statut of [STATUT_OCR.EN_COURS, STATUT_OCR.A_TRAITER]) {
        if (pagesRelancees >= MAX_RELANCES_PAR_PASSAGE) break;
        const snap = await pagesGroup()
          .where('statutOcr', '==', statut)
          .where('majAt', '<', cutoff)
          .limit(MAX_RELANCES_PAR_PASSAGE - pagesRelancees)
          .get();

        for (const doc of snap.docs) {
          const livreId = doc.ref.parent.parent?.id;
          if (!livreId) continue;
          const page = doc.data() as PageDoc;
          await doc.ref.update({
            statutOcr: STATUT_OCR.A_TRAITER,
            majAt: FieldValue.serverTimestamp(),
          });
          await enqueueWorkerTask(rt, cfg.ocrQueue, '/tasks/ocr-page', {
            livreId,
            numeroPage: page.numero,
          });
          pagesRelancees++;
          logger.info({ livreId, numero: page.numero, statutPrecedent: statut }, 'page relancée');
        }
      }

      // réveil de la structuration des livres en cours
      const livresSnap = await livresCol()
        .where('statut', '==', 'EN_COURS')
        .limit(MAX_LIVRES_PAR_PASSAGE)
        .get();
      for (const doc of livresSnap.docs) {
        await enqueueWorkerTask(rt, cfg.structQueue, '/tasks/structurer', { livreId: doc.id });
      }

      // fatwas structurées jamais indexées (tâche embed perdue)
      const fatwasSnap = await fatwasCol()
        .where('statut', '==', 'STRUCTUREE')
        .limit(MAX_EMBEDDINGS_PAR_PASSAGE)
        .get();
      for (const doc of fatwasSnap.docs) {
        await enqueueWorkerTask(rt, cfg.embedQueue, '/tasks/embed', { fatwaId: doc.id });
      }

      const bilan = {
        pagesRelancees,
        livresReveilles: livresSnap.size,
        embeddingsRattrapes: fatwasSnap.size,
      };
      logger.info(bilan, 'balayage de relance terminé');
      res.status(200).json(bilan);
    }),
  );

  return router;
}
