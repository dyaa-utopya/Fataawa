import { createHash } from 'node:crypto';
import { Router } from 'express';
import {
  FieldValue,
  type PageDoc,
  STATUT_OCR,
  type WorkerConfig,
  downloadFile,
  ensureSubfolder,
  enqueueWorkerTask,
  extractNumeroPage,
  findSubfolder,
  gcsList,
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
  pagesCol,
  sanitizeIdPart,
} from '@fataawa/core';
import { asyncHandler, errorMessage, tasksRuntime } from '../util.js';

interface IngestionStats {
  livres: number;
  ingerees: number;
  dejaVues: number;
  ignorees: number;
  erreurs: number;
}

/** Crée le document livre s'il n'existe pas encore. */
async function ensureLivre(livreId: string, titre: string, driveFolderId: string): Promise<void> {
  const ref = livreRef(livreId);
  if ((await ref.get()).exists) return;
  await ref.create({
    titre,
    driveFolderId,
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

/** Enregistre une page et enfile son OCR. */
async function registerPage(
  cfg: WorkerConfig,
  livreId: string,
  numero: number,
  gcsPath: string,
  mimeType: string,
  driveFileId: string,
  sha256: string,
): Promise<void> {
  await pageRef(livreId, pageIdFromNumero(numero)).create({
    numero,
    gcsPath,
    mimeType,
    driveFileId,
    sha256,
    statutOcr: STATUT_OCR.A_TRAITER,
    tentatives: 0,
    creeAt: FieldValue.serverTimestamp(),
    majAt: FieldValue.serverTimestamp(),
  });
  await livreRef(livreId).update({
    nbPages: FieldValue.increment(1),
    majAt: FieldValue.serverTimestamp(),
  });
  await enqueueWorkerTask(tasksRuntime(cfg), cfg.ocrQueue, '/tasks/ocr-page', {
    livreId,
    numeroPage: numero,
  });
}

/**
 * Ingestion depuis le bucket : les scans déposés sous
 * `{GCS_INBOX_PREFIX}{livreId}/{fichier}.png` deviennent des pages.
 * Les objets ne sont jamais déplacés — l'état vit dans Firestore, donc un
 * fichier déjà ingéré est simplement ignoré au passage suivant.
 */
async function ingestFromGcs(cfg: WorkerConfig, stats: IngestionStats, budget: number): Promise<number> {
  const objets = await gcsList(cfg.gcsBucket, cfg.gcsInboxPrefix);
  if (objets.length === 0) return budget;

  // regroupement par livre (premier segment après le préfixe)
  const parLivre = new Map<string, typeof objets>();
  for (const obj of objets) {
    const reste = obj.path.slice(cfg.gcsInboxPrefix.length);
    const sep = reste.indexOf('/');
    if (sep <= 0) {
      logger.warn({ objet: obj.path }, 'scan hors dossier de livre, ignoré');
      stats.ignorees++;
      continue;
    }
    const livreId = sanitizeIdPart(reste.slice(0, sep));
    if (livreId === '') {
      stats.ignorees++;
      continue;
    }
    const liste = parLivre.get(livreId) ?? [];
    liste.push(obj);
    parLivre.set(livreId, liste);
  }

  for (const [livreId, fichiers] of parLivre) {
    if (budget <= 0) break;
    const log = logger.child({ livreId, source: 'gcs' });
    await ensureLivre(livreId, livreId, '');
    // pages déjà connues : une seule requête (IDs seulement) au lieu d'une lecture par fichier
    const connues = new Set((await pagesCol(livreId).select().get()).docs.map((d) => d.id));
    stats.livres++;

    for (const obj of fichiers) {
      if (budget <= 0) break;
      try {
        const nom = obj.path.slice(obj.path.lastIndexOf('/') + 1);
        if (!isSupportedImageMime(obj.contentType)) {
          log.warn({ objet: obj.path, mime: obj.contentType }, 'type de fichier non géré, ignoré');
          stats.ignorees++;
          continue;
        }
        const numero = extractNumeroPage(nom);
        if (numero === null) {
          log.error({ objet: obj.path }, 'aucun numéro de page dans le nom de fichier, ignoré');
          stats.ignorees++;
          continue;
        }
        if (connues.has(pageIdFromNumero(numero))) {
          stats.dejaVues++;
          continue;
        }
        await registerPage(cfg, livreId, numero, obj.path, obj.contentType, '', '');
        connues.add(pageIdFromNumero(numero));
        budget--;
        stats.ingerees++;
        log.info({ objet: obj.path, numero }, 'page ingérée (bucket)');
      } catch (err) {
        stats.erreurs++;
        log.error({ objet: obj.path, err }, `ingestion en échec : ${errorMessage(err)}`);
      }
    }
  }
  return budget;
}

/**
 * Ingestion depuis Drive (connecteur optionnel) : les PNG du sous-dossier
 * « A TRAITER » de chaque livre sont copiés vers GCS. Idempotent par
 * driveFileId ; le déplacement vers « TRAITES » reste un simple signal
 * visuel pour les opérateurs.
 */
async function ingestFromDrive(cfg: WorkerConfig, stats: IngestionStats, budget: number): Promise<number> {
  const livres = await listBookFolders(cfg.driveRootFolderId);
  for (const livre of livres) {
    if (budget <= 0) break;
    const log = logger.child({ livreId: livre.id, livre: livre.name, source: 'drive' });

    const inboxId = await findSubfolder(livre.id, cfg.driveInboxName);
    if (!inboxId) continue;
    const fichiers = await listImages(inboxId, budget);
    if (fichiers.length === 0) continue;
    stats.livres++;

    await ensureLivre(livre.id, livre.name, livre.id);
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
        const existante = await pageRef(livre.id, pageId).get();

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
        await registerPage(cfg, livre.id, numero, gcsPath, fichier.mimeType, fichier.id, sha256);

        await moveFile(fichier.id, inboxId, doneId).catch((err: unknown) =>
          log.warn({ fichier: fichier.name, err }, 'déplacement Drive échoué (sera rejoué)'),
        );

        budget--;
        stats.ingerees++;
        log.info({ fichier: fichier.name, pageId, gcsPath }, 'page ingérée (Drive)');
      } catch (err) {
        stats.erreurs++;
        log.error({ fichier: fichier.name, err }, `ingestion en échec : ${errorMessage(err)}`);
      }
    }
  }
  return budget;
}

/**
 * POST /tasks/ingestion — déclenché par Cloud Scheduler.
 * Agnostique de la source : bucket GCS toujours, plus Drive si
 * DRIVE_ROOT_FOLDER_ID est configuré.
 */
export function ingestionRouter(cfg: WorkerConfig): Router {
  const router = Router();

  router.post(
    '/ingestion',
    asyncHandler(async (_req, res) => {
      const stats: IngestionStats = { livres: 0, ingerees: 0, dejaVues: 0, ignorees: 0, erreurs: 0 };
      let budget = cfg.ingestBatch;

      budget = await ingestFromGcs(cfg, stats, budget);
      if (cfg.driveRootFolderId !== '') {
        await ingestFromDrive(cfg, stats, budget);
      }

      logger.info({ ...stats, driveActif: cfg.driveRootFolderId !== '' }, 'ingestion terminée');
      res.status(200).json(stats);
    }),
  );

  return router;
}
