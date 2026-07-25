import { createHash } from 'node:crypto';
import { Router } from 'express';
import {
  FieldValue,
  type WorkerConfig,
  downloadFile,
  ensureSubfolder,
  enqueueWorkerTask,
  extractNumeroPage,
  findSubfolder,
  gcsPathForPage,
  gcsUpload,
  isSupportedImageMime,
  listBookFolders,
  listImages,
  livreRef,
  logger,
  moveFile,
  pageIdFromNumero,
  pageRef,
  STATUT_OCR,
  type PageDoc,
} from '@fataawa/core';
import { asyncHandler, errorMessage, tasksRuntime } from '../util.js';

interface IngestionStats {
  livres: number;
  ingerees: number;
  dejaVues: number;
  ignorees: number;
  erreurs: number;
}

/**
 * POST /tasks/ingestion — déclenché par Cloud Scheduler.
 * Parcourt les dossiers livres du Drive racine, copie les nouveaux scans du
 * sous-dossier « A TRAITER » vers GCS, crée les documents pages/ et enfile les
 * tâches OCR. Idempotent : une page déjà ingérée (même driveFileId) n'est
 * jamais retraitée, même si le fichier est remis dans le dossier.
 */
export function ingestionRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/ingestion',
    asyncHandler(async (_req, res) => {
      const stats: IngestionStats = { livres: 0, ingerees: 0, dejaVues: 0, ignorees: 0, erreurs: 0 };
      let budget = cfg.ingestBatch;

      const livres = await listBookFolders(cfg.driveRootFolderId);
      for (const livre of livres) {
        if (budget <= 0) break;
        const log = logger.child({ livreId: livre.id, livre: livre.name });

        const inboxId = await findSubfolder(livre.id, cfg.driveInboxName);
        if (!inboxId) continue; // pas de dossier « A TRAITER » : rien à faire pour ce livre

        const fichiers = await listImages(inboxId, budget);
        if (fichiers.length === 0) continue;
        stats.livres++;

        const ref = livreRef(livre.id);
        if (!(await ref.get()).exists) {
          await ref.create({
            titre: livre.name,
            driveFolderId: livre.id,
            statut: 'EN_COURS',
            nbPages: 0,
            nbPagesOcr: 0,
            nbFatwas: 0,
            curseurStructuration: 0,
            fatwaOuverte: null,
            creeAt: FieldValue.serverTimestamp(),
            majAt: FieldValue.serverTimestamp(),
          });
        }
        const doneId = await ensureSubfolder(livre.id, cfg.driveDoneName);

        for (const fichier of fichiers) {
          if (budget <= 0) break;
          try {
            if (!isSupportedImageMime(fichier.mimeType)) {
              log.warn({ fichier: fichier.name, mime: fichier.mimeType }, 'type de fichier non géré, ignoré');
              stats.ignorees++;
              continue;
            }
            const numero = extractNumeroPage(fichier.name);
            if (numero === null) {
              log.error({ fichier: fichier.name }, 'aucun numéro de page dans le nom de fichier, ignoré');
              stats.ignorees++;
              continue;
            }
            const pageId = pageIdFromNumero(numero);
            const pRef = pageRef(livre.id, pageId);
            const existante = await pRef.get();

            if (existante.exists) {
              const page = existante.data() as PageDoc;
              if (page.driveFileId === fichier.id) {
                // déjà ingérée : seul le déplacement Drive a dû échouer → on le rejoue
                await moveFile(fichier.id, inboxId, doneId).catch((err: unknown) =>
                  log.warn({ fichier: fichier.name, err }, 'déplacement Drive rejoué en échec'),
                );
                stats.dejaVues++;
              } else {
                log.error(
                  { fichier: fichier.name, pageId, driveFileIdExistant: page.driveFileId },
                  'conflit : deux fichiers Drive pour le même numéro de page, fichier ignoré',
                );
                stats.ignorees++;
              }
              continue;
            }

            const contenu = await downloadFile(fichier.id);
            const sha256 = createHash('sha256').update(contenu).digest('hex');
            const gcsPath = gcsPathForPage(livre.id, pageId, fichier.mimeType);
            await gcsUpload(cfg.gcsBucket, gcsPath, contenu, fichier.mimeType);

            await pRef.create({
              numero,
              gcsPath,
              mimeType: fichier.mimeType,
              driveFileId: fichier.id,
              sha256,
              statutOcr: STATUT_OCR.A_TRAITER,
              tentatives: 0,
              creeAt: FieldValue.serverTimestamp(),
              majAt: FieldValue.serverTimestamp(),
            });
            await ref.update({ nbPages: FieldValue.increment(1), majAt: FieldValue.serverTimestamp() });

            await enqueueWorkerTask(tasksRuntime(cfg), cfg.ocrQueue, '/tasks/ocr-page', {
              livreId: livre.id,
              numeroPage: numero,
            });

            // signal visuel pour les opérateurs — la vérité reste Firestore
            await moveFile(fichier.id, inboxId, doneId).catch((err: unknown) =>
              log.warn({ fichier: fichier.name, err }, 'déplacement Drive échoué (sera rejoué)'),
            );

            budget--;
            stats.ingerees++;
            log.info({ fichier: fichier.name, pageId, gcsPath }, 'page ingérée');
          } catch (err) {
            stats.erreurs++;
            log.error({ fichier: fichier.name, err }, `ingestion en échec : ${errorMessage(err)}`);
          }
        }
      }

      logger.info({ ...stats }, 'ingestion terminée');
      res.status(200).json(stats);
    }),
  );

  return router;
}
