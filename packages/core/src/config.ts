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
  /** Connecteur Drive optionnel : vide = ingestion depuis le bucket uniquement. */
  DRIVE_ROOT_FOLDER_ID: z.string().default(''),
  DRIVE_INBOX_NAME: z.string().min(1).default('A TRAITER'),
  DRIVE_DONE_NAME: z.string().min(1).default('TRAITES'),
  /** Préfixe GCS où déposer les scans : inbox/{livreId}/{fichier}.png */
  GCS_INBOX_PREFIX: z.string().default('inbox/'),
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
  /**
   * Taille de la fenêtre de lecture : la page structurée plus les suivantes,
   * fournies en contexte pour voir la fin des fatwas qui débordent.
   */
  STRUCT_WINDOW_PAGES: z.coerce.number().int().min(1).max(6).default(3),
  /**
   * Au-delà, le texte n'est plus celui d'une page : l'OCR s'est emballé. Mesuré
   * sur les dix recueils, une page tient entre 1 000 et 4 000 caractères, et
   * 54 pages de sommaire sur 4 870 sont ressorties à 131 000 — une répétition
   * sans fin de points de conduite, qui fait échouer la structuration.
   */
  STRUCT_MAX_PAGE_CHARS: z.coerce.number().int().min(4000).default(20000),
  /** Rendu des PDF : PNG sans perte, résolution suffisante pour l'OCR arabe. */
  PDF_DPI: z.coerce.number().int().min(100).max(600).default(300),
  PDF_PAGES_PAR_LOT: z.coerce.number().int().min(5).max(200).default(50),
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
  gcsInboxPrefix: string;
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
  structWindowPages: number;
  structMaxPageChars: number;
  pdfDpi: number;
  pdfPagesParLot: number;
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
    gcsInboxPrefix: raw.GCS_INBOX_PREFIX,
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
    structWindowPages: raw.STRUCT_WINDOW_PAGES,
    structMaxPageChars: raw.STRUCT_MAX_PAGE_CHARS,
    pdfDpi: raw.PDF_DPI,
    pdfPagesParLot: raw.PDF_PAGES_PAR_LOT,
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
  /**
   * Tours d'historique envoyés au modèle. Cinq tours = dix messages, ce qui est
   * exactement la mémoire que le front laisse vivre : au-delà il repart sur une
   * conversation neuve, et le serveur ne doit pas en garder plus que lui.
   */
  HISTORY_TURNS: z.coerce.number().int().min(0).max(20).default(5),
  SIGNED_URL_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /** Débit par IP sur la recherche : un seul appel au modèle, donc large. */
  RATE_LIMIT_RPM: z.coerce.number().int().min(1).default(30),
  /**
   * Débit par IP sur les questions. Trois fois plus coûteux qu'une recherche
   * (triage + génération + embedding), d'où une limite propre et plus basse.
   */
  ASK_RATE_LIMIT_RPM: z.coerce.number().int().min(1).default(12),
  /**
   * Durée de conservation d'une conversation en base. Le front l'efface au bout
   * de trois minutes d'inactivité ; ce délai-ci ne sert qu'à ne pas garder
   * indéfiniment des questions dont personne n'a plus besoin.
   */
  CONVERSATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /** Où chercher les scans des fatwas historiques (champ image_source). */
  LEGACY_IMAGE_PREFIX: z.string().default('legacy/'),
  /** Préfixe de dépôt des nouveaux scans (identique au worker). */
  GCS_INBOX_PREFIX: z.string().default('inbox/'),
  /** Nécessaires au déclenchement de l'ingestion depuis l'espace d'ajout. */
  REGION: z.string().min(1).default('us-central1'),
  WORKER_URL: z.string().default(''),
  TASKS_SA_EMAIL: z.string().default(''),
  OCR_QUEUE: z.string().min(1).default('ocr'),
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
  askRateLimitRpm: number;
  conversationTtlHours: number;
  legacyImagePrefix: string;
  gcsInboxPrefix: string;
  region: string;
  workerUrl: string;
  tasksServiceAccountEmail: string;
  ocrQueue: string;
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
    askRateLimitRpm: raw.ASK_RATE_LIMIT_RPM,
    conversationTtlHours: raw.CONVERSATION_TTL_HOURS,
    legacyImagePrefix: raw.LEGACY_IMAGE_PREFIX,
    gcsInboxPrefix: raw.GCS_INBOX_PREFIX,
    region: raw.REGION,
    workerUrl: raw.WORKER_URL.replace(/\/$/, ''),
    tasksServiceAccountEmail: raw.TASKS_SA_EMAIL,
    ocrQueue: raw.OCR_QUEUE,
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
