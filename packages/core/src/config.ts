import { z } from 'zod';

/**
 * Configuration du worker, validée au démarrage (fail fast).
 * En production, tout vient des variables d'environnement posées par
 * infra/deploy-worker.sh ; GEMINI_API_KEY est montée depuis Secret Manager.
 */
const workerConfigSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  REGION: z.string().min(1).default('us-central1'),
  GCS_BUCKET: z.string().min(1),
  DRIVE_ROOT_FOLDER_ID: z.string().min(1),
  DRIVE_INBOX_NAME: z.string().min(1).default('A TRAITER'),
  DRIVE_DONE_NAME: z.string().min(1).default('TRAITES'),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
  OCR_QUEUE: z.string().min(1).default('ocr'),
  WORKER_URL: z.string().url(),
  TASKS_SA_EMAIL: z.string().email(),
  MAX_OCR_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  INGEST_BATCH: z.coerce.number().int().min(1).default(100),
  STUCK_AFTER_MINUTES: z.coerce.number().int().min(5).default(30),
});

export interface WorkerConfig {
  project: string;
  region: string;
  gcsBucket: string;
  driveRootFolderId: string;
  driveInboxName: string;
  driveDoneName: string;
  geminiApiKey: string;
  geminiModel: string;
  ocrQueue: string;
  workerUrl: string;
  tasksServiceAccountEmail: string;
  maxOcrAttempts: number;
  ingestBatch: number;
  stuckAfterMinutes: number;
}

export function parseWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const raw = workerConfigSchema.parse(env);
  return {
    project: raw.GOOGLE_CLOUD_PROJECT,
    region: raw.REGION,
    gcsBucket: raw.GCS_BUCKET,
    driveRootFolderId: raw.DRIVE_ROOT_FOLDER_ID,
    driveInboxName: raw.DRIVE_INBOX_NAME,
    driveDoneName: raw.DRIVE_DONE_NAME,
    geminiApiKey: raw.GEMINI_API_KEY,
    geminiModel: raw.GEMINI_MODEL,
    ocrQueue: raw.OCR_QUEUE,
    workerUrl: raw.WORKER_URL.replace(/\/$/, ''),
    tasksServiceAccountEmail: raw.TASKS_SA_EMAIL,
    maxOcrAttempts: raw.MAX_OCR_ATTEMPTS,
    ingestBatch: raw.INGEST_BATCH,
    stuckAfterMinutes: raw.STUCK_AFTER_MINUTES,
  };
}

let cached: WorkerConfig | undefined;

export function workerConfig(): WorkerConfig {
  cached ??= parseWorkerConfig(process.env);
  return cached;
}

export function resetWorkerConfigForTests(): void {
  cached = undefined;
}
