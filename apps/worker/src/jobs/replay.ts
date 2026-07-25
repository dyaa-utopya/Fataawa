import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import {
  COL_FATWAS,
  FieldValue,
  enqueueWorkerTask,
  livreRef,
  livresCol,
  logger,
  pagesCol,
  sanitizeIdPart,
} from '@fataawa/core';

/**
 * Rejoue un ou plusieurs livres dans le pipeline actuel, à partir des scans
 * déjà présents dans le bucket sous `legacy/{livre}/`.
 *
 * Les copies `legacy/ → inbox/` sont faites côté GCS (serveur à serveur :
 * rien ne transite ici), puis l'ingestion habituelle prend le relais — OCR,
 * structuration par fenêtre de lecture, embeddings.
 *
 * Sert à reprendre les recueils structurés par l'ancien pipeline Apps Script,
 * dont les fatwas à cheval sur deux pages étaient dupliquées et mal
 * thématisées. À lancer avec FATWAS_COLLECTION pointant sur une collection
 * neuve : la collection en service n'est jamais touchée.
 *
 * RESET=1 remet à zéro les pages et le curseur des livres visés (rejeu propre).
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  REGION: z.string().min(1).default('us-central1'),
  GCS_BUCKET: z.string().min(1),
  WORKER_URL: z.string().url(),
  TASKS_SA_EMAIL: z.string().email(),
  OCR_QUEUE: z.string().min(1).default('ocr'),
  LEGACY_IMAGE_PREFIX: z.string().default('legacy/'),
  GCS_INBOX_PREFIX: z.string().default('inbox/'),
  /** Livres à rejouer (préfixes sous legacy/), séparés par « ; ». Vide = tous. */
  LIVRES: z.string().default(''),
  /** Nombre de passages d'ingestion enfilés après la copie. */
  INGESTIONS: z.coerce.number().int().min(1).max(200).default(30),
  RESET: z.string().optional(),
});

async function supprimerPages(livreId: string): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await pagesCol(livreId).select().limit(400).get();
    if (snap.empty) break;
    const batch = pagesCol(livreId).firestore.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    total += snap.size;
  }
  return total;
}

async function main(): Promise<void> {
  const cfg = configSchema.parse(process.env);
  const reset = cfg.RESET === '1' || cfg.RESET === 'true';
  const storage = new Storage();
  const bucket = storage.bucket(cfg.GCS_BUCKET);

  logger.info(
    { collectionCible: COL_FATWAS, reset, livresDemandes: cfg.LIVRES || 'tous' },
    'rejeu démarré',
  );

  // livres disponibles sous legacy/ (un « dossier » = un recueil)
  const [, , apiResponse] = await bucket.getFiles({
    prefix: cfg.LEGACY_IMAGE_PREFIX,
    delimiter: '/',
    autoPaginate: false,
  });
  const dossiers = ((apiResponse as { prefixes?: string[] } | undefined)?.prefixes ?? []).map((p) =>
    p.slice(cfg.LEGACY_IMAGE_PREFIX.length).replace(/\/$/, ''),
  );
  const demandes = cfg.LIVRES.split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const livres = demandes.length > 0 ? demandes : dossiers;
  if (livres.length === 0) throw new Error(`aucun livre trouvé sous ${cfg.LEGACY_IMAGE_PREFIX}`);
  logger.info({ disponibles: dossiers.length, retenus: livres }, 'livres à rejouer');

  let copies = 0;
  let deja = 0;
  for (const livre of livres) {
    const livreId = sanitizeIdPart(livre);
    const log = logger.child({ livre: livreId });

    if (reset) {
      const supprimees = await supprimerPages(livreId);
      await livreRef(livreId)
        .set(
          {
            curseurStructuration: 0,
            fatwaOuverte: null,
            nbPages: 0,
            nbPagesOcr: 0,
            nbFatwas: 0,
            majAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => undefined);
      log.info({ pagesSupprimees: supprimees }, 'état du livre réinitialisé');
    }

    const [fichiers] = await bucket.getFiles({ prefix: `${cfg.LEGACY_IMAGE_PREFIX}${livre}/` });
    log.info({ fichiers: fichiers.length }, 'copie legacy → inbox');
    for (const f of fichiers) {
      if (f.name.endsWith('/')) continue;
      const nom = f.name.slice(f.name.lastIndexOf('/') + 1);
      const cible = bucket.file(`${cfg.GCS_INBOX_PREFIX}${livreId}/${nom}`);
      if ((await cible.exists())[0]) {
        deja++;
        continue;
      }
      await f.copy(cible);
      copies++;
      if (copies % 250 === 0) log.info({ copies }, 'copie en cours…');
    }
  }

  // L'ingestion traite un lot borné par passage : on en enfile plusieurs,
  // espacés, jusqu'à absorber tous les scans copiés.
  const rt = {
    project: cfg.GOOGLE_CLOUD_PROJECT,
    region: cfg.REGION,
    workerUrl: cfg.WORKER_URL.replace(/\/$/, ''),
    serviceAccountEmail: cfg.TASKS_SA_EMAIL,
  };
  for (let i = 0; i < cfg.INGESTIONS; i++) {
    await enqueueWorkerTask(rt, cfg.OCR_QUEUE, '/tasks/ingestion', {}, i * 90);
  }

  logger.info(
    { copies, deja, ingestionsEnfilees: cfg.INGESTIONS, collectionCible: COL_FATWAS },
    'rejeu préparé — le pipeline prend le relais',
  );
  // trace utile : nombre de livres déjà connus de Firestore
  logger.info({ livresEnBase: (await livresCol().select().get()).size }, 'état des livres');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'rejeu en échec');
  process.exitCode = 1;
});
