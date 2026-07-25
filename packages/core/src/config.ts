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
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  EMBEDDING_DIM: z.coerce.number().int().min(64).max(2048).default(768),
  OCR_QUEUE: z.string().min(1).default('ocr'),
  STRUCT_QUEUE: z.string().min(1).default('structuration'),
  EMBED_QUEUE: z.string().min(1).default('embedding'),
  WORKER_URL: z.string().url(),
  TASKS_SA_EMAIL: z.string().email(),
  MAX_OCR_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  STRUCT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  STRUCT_PAGES_PER_RUN: z.coerce.number().int().min(1).default(12),
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
  embeddingModel: string;
  embeddingDim: number;
  ocrQueue: string;
  structQueue: string;
  embedQueue: string;
  workerUrl: string;
  tasksServiceAccountEmail: string;
  maxOcrAttempts: number;
  structMaxAttempts: number;
  structPagesPerRun: number;
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
    embeddingModel: raw.EMBEDDING_MODEL,
    embeddingDim: raw.EMBEDDING_DIM,
    ocrQueue: raw.OCR_QUEUE,
    structQueue: raw.STRUCT_QUEUE,
    embedQueue: raw.EMBED_QUEUE,
    workerUrl: raw.WORKER_URL.replace(/\/$/, ''),
    tasksServiceAccountEmail: raw.TASKS_SA_EMAIL,
    maxOcrAttempts: raw.MAX_OCR_ATTEMPTS,
    structMaxAttempts: raw.STRUCT_MAX_ATTEMPTS,
    structPagesPerRun: raw.STRUCT_PAGES_PER_RUN,
    ingestBatch: raw.INGEST_BATCH,
    stuckAfterMinutes: raw.STUCK_AFTER_MINUTES,
  };
}

let cachedWorker: WorkerConfig | undefined;

export function workerConfig(): WorkerConfig {
  cachedWorker ??= parseWorkerConfig(process.env);
  return cachedWorker;
}

/**
 * Configuration de l'API publique (service `chercherf`).
 */
const apiConfigSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GCS_BUCKET: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
  EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
  EMBEDDING_DIM: z.coerce.number().int().min(64).max(2048).default(768),
  TOP_K: z.coerce.number().int().min(1).max(20).default(6),
  HISTORY_TURNS: z.coerce.number().int().min(0).max(20).default(6),
  SIGNED_URL_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  RATE_LIMIT_RPM: z.coerce.number().int().min(1).default(20),
});

export interface ApiConfig {
  project: string;
  gcsBucket: string;
  geminiApiKey: string;
  geminiModel: string;
  embeddingModel: string;
  embeddingDim: number;
  topK: number;
  historyTurns: number;
  signedUrlTtlMinutes: number;
  rateLimitRpm: number;
}

export function parseApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const raw = apiConfigSchema.parse(env);
  return {
    project: raw.GOOGLE_CLOUD_PROJECT,
    gcsBucket: raw.GCS_BUCKET,
    geminiApiKey: raw.GEMINI_API_KEY,
    geminiModel: raw.GEMINI_MODEL,
    embeddingModel: raw.EMBEDDING_MODEL,
    embeddingDim: raw.EMBEDDING_DIM,
    topK: raw.TOP_K,
    historyTurns: raw.HISTORY_TURNS,
    signedUrlTtlMinutes: raw.SIGNED_URL_TTL_MINUTES,
    rateLimitRpm: raw.RATE_LIMIT_RPM,
  };
}

let cachedApi: ApiConfig | undefined;

export function apiConfig(): ApiConfig {
  cachedApi ??= parseApiConfig(process.env);
  return cachedApi;
}

export function resetConfigForTests(): void {
  cachedWorker = undefined;
  cachedApi = undefined;
}
