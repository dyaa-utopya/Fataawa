import { sheets as createSheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import {
  FieldValue,
  enqueueWorkerTask,
  fatwaIdFrom,
  fatwaRef,
  fromPipeline,
  logger,
} from '@fataawa/core';
import { parseMapping, rowToLigne } from './mapping.js';

/**
 * Backfill one-shot : importe le MASTER_SHEET historique (produit par les
 * robots Apps Script) dans la collection `fatwas`, puis enfile les tâches
 * d'embedding. Exécuté comme Cloud Run Job (infra/run-backfill.sh).
 * Idempotent : IDs déterministes, relancer réécrit les mêmes documents.
 * Lancer d'abord avec DRY_RUN=1 pour vérifier le mapping des colonnes.
 */
const jobConfigSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  REGION: z.string().min(1).default('us-central1'),
  EMBED_QUEUE: z.string().min(1).default('embedding'),
  WORKER_URL: z.string().url(),
  TASKS_SA_EMAIL: z.string().email(),
  MASTER_SHEET_ID: z.string().min(1),
  MASTER_RANGE: z.string().min(1).default('A2:Z'),
  MASTER_MAPPING: z.string().min(1).default('id=A,sujet=B,sousSujet=C,numero=D,texte=E'),
  MASTER_LIVRE_ID: z.string().min(1).default('import-master'),
  DRY_RUN: z.string().optional(),
});

async function main(): Promise<void> {
  const env = jobConfigSchema.parse(process.env);
  const mapping = parseMapping(env.MASTER_MAPPING);
  const dryRun = env.DRY_RUN === '1' || env.DRY_RUN === 'true';
  const rt = {
    project: env.GOOGLE_CLOUD_PROJECT,
    region: env.REGION,
    workerUrl: env.WORKER_URL.replace(/\/$/, ''),
    serviceAccountEmail: env.TASKS_SA_EMAIL,
  };

  const sheets = createSheets({
    version: 'v4',
    auth: new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }),
  });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.MASTER_SHEET_ID,
    range: env.MASTER_RANGE,
  });
  const rows = (res.data.values ?? []) as unknown[][];
  logger.info({ lignes: rows.length, mapping: env.MASTER_MAPPING, dryRun }, 'backfill démarré');

  let importees = 0;
  let ignorees = 0;
  for (const [i, row] of rows.entries()) {
    const ligne = rowToLigne(row, mapping);
    if (!ligne) {
      ignorees++;
      continue;
    }
    const livreId = ligne.livre !== '' ? ligne.livre : env.MASTER_LIVRE_ID;
    const base = ligne.id !== '' ? ligne.id : ligne.numero;
    const fatwaId = fatwaIdFrom(livreId, base, `row${i + 2}`);

    if (dryRun) {
      if (importees < 3) logger.info({ fatwaId, ligne }, 'DRY_RUN — exemple de ligne parsée');
      importees++;
      continue;
    }

    await fatwaRef(fatwaId).set(
      {
        ...fromPipeline({
          livreId,
          numero: ligne.numero !== '' ? ligne.numero : ligne.id,
          // reprise d'une feuille historique : ses thèmes ne suivent pas la
          // taxonomie, on les conserve tels quels et on marque l'incomplétude
          themeN1: ligne.sujet,
          themeN2: ligne.sousSujet,
          themeN3: '',
          themesComplets: false,
          texte: ligne.texte,
          pages: [],
        }),
        source: 'backfill-master',
        majAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await enqueueWorkerTask(rt, env.EMBED_QUEUE, '/tasks/embed', { fatwaId });

    importees++;
    if (importees % 200 === 0) logger.info({ importees }, 'backfill en cours…');
  }

  logger.info({ importees, ignorees, dryRun }, 'backfill terminé');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'backfill en échec');
  process.exitCode = 1;
});
