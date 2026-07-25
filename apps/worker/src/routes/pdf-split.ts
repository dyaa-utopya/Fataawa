import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import {
  type WorkerConfig,
  enqueueWorkerTask,
  gcsDownload,
  gcsExists,
  gcsUpload,
  logger,
  nomPageRendue,
  pdfNombrePages,
  pdfRendrePages,
  pdfTextePage,
} from '@fataawa/core';
import { asyncHandler, errorMessage, tasksRuntime } from '../util.js';

const payloadSchema = z.object({
  /** Identifiant du livre (dossier de destination). */
  livreId: z.string().min(1),
  /** Objet GCS du PDF déposé. */
  pdfPath: z.string().min(1),
  /** Première page de la plage à rendre (1 par défaut). */
  depuis: z.number().int().min(1).default(1),
});

/**
 * POST /tasks/pdf-split — découpe un PDF déposé dans le bucket en pages PNG,
 * déposées dans `inbox/{livreId}/`, où l'ingestion habituelle les récupère.
 *
 * Traite une plage bornée de pages puis se ré-enfile pour la suivante : la
 * mémoire reste basse (les pages rendues sont envoyées puis effacées) et la
 * requête tient dans le délai du worker, quel que soit le nombre de pages.
 * Idempotent : une page déjà présente dans le bucket n'est pas re-rendue.
 *
 * Les pages sont nommées d'après leur rang dans le PDF (`page_0007.png`) :
 * le numéro ne dépend plus du nom des fichiers exportés à la main.
 */
export function pdfSplitRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/pdf-split',
    asyncHandler(async (req, res) => {
      const parsed = payloadSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.error({ body: req.body }, 'payload pdf-split invalide, tâche abandonnée');
        res.status(200).json({ ignoree: 'payload invalide' });
        return;
      }
      const { livreId, pdfPath, depuis } = parsed.data;
      const log = logger.child({ livreId, pdfPath, depuis });

      let travail: string | undefined;
      try {
        travail = await mkdtemp(join(tmpdir(), 'fataawa-pdf-'));
        const local = join(travail, 'source.pdf');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(local, await gcsDownload(cfg.gcsBucket, pdfPath));

        const total = await pdfNombrePages(local);
        if (depuis === 1) {
          // information utile : un PDF déjà océrisé permettrait d'économiser l'OCR
          const texte = await pdfTextePage(local, 1);
          log.info(
            { pages: total, coucheTexte: texte.length > 200 ? 'oui' : 'non', dpi: cfg.pdfDpi },
            'découpage du PDF démarré',
          );
        }

        const derniere = Math.min(total, depuis + cfg.pdfPagesParLot - 1);
        const sortie = join(travail, 'pages');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(sortie, { recursive: true });

        let rendues = 0;
        let dejaLa = 0;
        const { fichiers } = await pdfRendrePages(local, sortie, depuis, derniere, cfg.pdfDpi);
        for (const f of fichiers) {
          const objet = `${cfg.gcsInboxPrefix}${livreId}/${nomPageRendue(livreId, f.page)}`;
          if (await gcsExists(cfg.gcsBucket, objet)) {
            dejaLa++;
            continue;
          }
          await gcsUpload(cfg.gcsBucket, objet, await readFile(f.chemin), 'image/png');
          rendues++;
        }

        const rt = tasksRuntime(cfg);
        if (derniere < total) {
          await enqueueWorkerTask(rt, cfg.ocrQueue, '/tasks/pdf-split', {
            livreId,
            pdfPath,
            depuis: derniere + 1,
          });
        }
        // l'ingestion prend le relais sur ce qui vient d'être déposé
        await enqueueWorkerTask(rt, cfg.ocrQueue, '/tasks/ingestion', {}, 15);

        log.info(
          { plage: `${depuis}-${derniere}`, total, rendues, dejaLa, reste: derniere < total },
          'plage de pages rendue',
        );
        res.status(200).json({ total, plage: [depuis, derniere], rendues, dejaLa });
      } catch (err) {
        log.warn({ err }, `découpage PDF en échec : ${errorMessage(err)}, retry via Cloud Tasks`);
        res.status(503).json({ retry: true });
      } finally {
        if (travail) await rm(travail, { recursive: true, force: true }).catch(() => undefined);
      }
    }),
  );

  return router;
}
