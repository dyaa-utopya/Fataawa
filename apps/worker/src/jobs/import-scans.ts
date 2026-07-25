import { z } from 'zod';
import {
  FieldValue,
  type FatwaStored,
  db,
  downloadFile,
  fatwasCol,
  gcsExists,
  gcsUpload,
  listAllImages,
  listBookFolders,
  logger,
  sanitizeIdPart,
} from '@fataawa/core';
import { creerIndex, indexer, nomLivrePropre, resoudre } from './scan-names.js';

/**
 * Import one-shot des scans historiques : dossier Drive racine (un
 * sous-dossier par livre) → bucket, sous `{LEGACY_IMAGE_PREFIX}{livre}/`.
 *
 * Deux temps :
 *  1. copie des images (idempotent : un objet déjà présent est ignoré) ;
 *  2. raccordement — chaque fatwa de `fatawas_db` dont le champ
 *     `image_source` correspond à un scan reçoit son `gcs_path`, ce qui
 *     permet à l'API de servir la page scannée sans deviner de chemin.
 *
 * Rejouable : relancer ne recopie rien et complète les raccordements
 * manquants. DRY_RUN=1 n'écrit ni dans GCS ni dans Firestore.
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GCS_BUCKET: z.string().min(1),
  DRIVE_ROOT_FOLDER_ID: z.string().min(1),
  LEGACY_IMAGE_PREFIX: z.string().default('legacy/'),
  CONCURRENCY: z.coerce.number().int().min(1).max(16).default(8),
  DRY_RUN: z.string().optional(),
});

const PAGE_FIRESTORE = 300;
const MAX_BATCH = 400;
/** Les scans sont rangés dans des sous-dossiers (« TRAITES », « A TRAITER »…). */
const PROFONDEUR_MAX = 3;

/** Toutes les images d'un livre, sous-dossiers compris. */
async function imagesDuLivre(racineId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const images: Array<{ id: string; name: string; mimeType: string }> = [];
  let niveau = [racineId];
  for (let profondeur = 0; profondeur < PROFONDEUR_MAX && niveau.length > 0; profondeur++) {
    const suivant: string[] = [];
    for (const dossierId of niveau) {
      images.push(...(await listAllImages(dossierId)));
      for (const sous of await listBookFolders(dossierId)) suivant.push(sous.id);
    }
    niveau = suivant;
  }
  return images;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const item = items[next++];
        if (item === undefined) return;
        await fn(item);
      }
    }),
  );
}

async function main(): Promise<void> {
  const cfg = configSchema.parse(process.env);
  const dryRun = cfg.DRY_RUN === '1' || cfg.DRY_RUN === 'true';
  const index = creerIndex();
  let copies = 0;
  let deja = 0;
  let echecs = 0;

  const livres = await listBookFolders(cfg.DRIVE_ROOT_FOLDER_ID);
  logger.info({ livres: livres.length, dryRun }, 'import des scans démarré');

  for (const livre of livres) {
    const nomLivre = nomLivrePropre(livre.name);
    const log = logger.child({ livre: nomLivre });
    const images = await imagesDuLivre(livre.id);
    if (images.length === 0) {
      log.warn('aucune image trouvée (sous-dossiers compris)');
      continue;
    }
    const prefixe = `${cfg.LEGACY_IMAGE_PREFIX}${sanitizeIdPart(nomLivre)}/`;
    log.info({ images: images.length, prefixe }, 'copie du livre');

    await mapWithConcurrency(images, cfg.CONCURRENCY, async (image) => {
      const gcsPath = `${prefixe}${image.name.normalize('NFC')}`;
      indexer(index, nomLivre, image.name, gcsPath);
      try {
        if (await gcsExists(cfg.GCS_BUCKET, gcsPath)) {
          deja++;
          return;
        }
        if (dryRun) return;
        const contenu = await downloadFile(image.id);
        await gcsUpload(cfg.GCS_BUCKET, gcsPath, contenu, image.mimeType);
        copies++;
        if (copies % 200 === 0) log.info({ copies }, 'copie en cours…');
      } catch (err) {
        echecs++;
        log.error({ fichier: image.name, err }, 'copie en échec');
      }
    });
  }
  logger.info(
    { copies, deja, echecs, scansIndexes: index.parNom.size },
    'copie terminée — raccordement des fatwas',
  );

  // raccordement : image_source → gcs_path
  let cursor: string | undefined;
  let raccordees = 0;
  let dejaRaccordees = 0;
  let orphelines = 0;
  for (;;) {
    let query = fatwasCol()
      .orderBy('__name__')
      .select('image_source', 'gcs_path')
      .limit(PAGE_FIRESTORE);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    cursor = snap.docs[snap.docs.length - 1]?.id;

    let batch = db().batch();
    let enAttente = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as FatwaStored;
      const source = data.image_source ?? '';
      if (source === '') continue;
      if ((data.gcs_path ?? '') !== '') {
        dejaRaccordees++;
        continue;
      }
      const gcsPath = resoudre(index, source);
      if (!gcsPath) {
        orphelines++;
        continue;
      }
      if (!dryRun) {
        batch.update(doc.ref, { gcs_path: gcsPath, majAt: FieldValue.serverTimestamp() });
        enAttente++;
        if (enAttente >= MAX_BATCH) {
          await batch.commit();
          batch = db().batch();
          enAttente = 0;
        }
      }
      raccordees++;
    }
    if (enAttente > 0) await batch.commit();
    if (snap.size < PAGE_FIRESTORE) break;
  }

  logger.info(
    { raccordees, dejaRaccordees, orphelines, copies, deja, echecs, dryRun },
    'import des scans terminé',
  );
  if (echecs > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  logger.error({ err }, 'import des scans en échec');
  process.exitCode = 1;
});
