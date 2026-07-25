import { Router } from 'express';
import {
  FieldValue,
  type PageDoc,
  STATUT_OCR,
  Timestamp,
  type WorkerConfig,
  enqueueOcrTask,
  logger,
  pagesGroup,
} from '@fataawa/core';
import { asyncHandler } from '../util.js';

const MAX_RELANCES_PAR_PASSAGE = 200;

/**
 * POST /tasks/relance — balayage horaire (Cloud Scheduler).
 * Ré-enfile les pages restées EN_COURS (instance crashée) ou A_TRAITER
 * (tâche perdue) depuis plus de STUCK_AFTER_MINUTES. Sans risque : le
 * handler OCR est idempotent, un doublon de tâche est sans effet.
 */
export function relanceRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/relance',
    asyncHandler(async (_req, res) => {
      const cutoff = Timestamp.fromMillis(Date.now() - cfg.stuckAfterMinutes * 60_000);
      let relancees = 0;

      for (const statut of [STATUT_OCR.EN_COURS, STATUT_OCR.A_TRAITER]) {
        const snap = await pagesGroup()
          .where('statutOcr', '==', statut)
          .where('majAt', '<', cutoff)
          .limit(MAX_RELANCES_PAR_PASSAGE - relancees)
          .get();

        for (const doc of snap.docs) {
          const livreId = doc.ref.parent.parent?.id;
          if (!livreId) continue;
          const page = doc.data() as PageDoc;
          await doc.ref.update({
            statutOcr: STATUT_OCR.A_TRAITER,
            majAt: FieldValue.serverTimestamp(),
          });
          await enqueueOcrTask(
            {
              project: cfg.project,
              region: cfg.region,
              queue: cfg.ocrQueue,
              workerUrl: cfg.workerUrl,
              serviceAccountEmail: cfg.tasksServiceAccountEmail,
            },
            { livreId, numeroPage: page.numero },
          );
          relancees++;
          logger.info({ livreId, numero: page.numero, statutPrecedent: statut }, 'page relancée');
        }
        if (relancees >= MAX_RELANCES_PAR_PASSAGE) break;
      }

      logger.info({ relancees }, 'balayage de relance terminé');
      res.status(200).json({ relancees });
    }),
  );

  return router;
}
