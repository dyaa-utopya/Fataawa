import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../src/config.js';

const baseEnv = {
  GOOGLE_CLOUD_PROJECT: 'looker-studio-458310',
  GCS_BUCKET: 'bucket-test',
  DRIVE_ROOT_FOLDER_ID: 'folder123',
  GEMINI_API_KEY: 'cle-test',
  WORKER_URL: 'https://worker.example.com/',
  TASKS_SA_EMAIL: 'sa@projet.iam.gserviceaccount.com',
};

describe('parseWorkerConfig', () => {
  it('applique les défauts et normalise', () => {
    const cfg = parseWorkerConfig({ ...baseEnv });
    expect(cfg.region).toBe('us-central1');
    expect(cfg.geminiModel).toBe('gemini-3.1-flash-lite');
    expect(cfg.ocrQueue).toBe('ocr');
    expect(cfg.maxOcrAttempts).toBe(3);
    expect(cfg.driveInboxName).toBe('A TRAITER');
    // le slash final de WORKER_URL est retiré (sert d'audience OIDC)
    expect(cfg.workerUrl).toBe('https://worker.example.com');
  });

  it('coerce les nombres depuis les variables texte', () => {
    const cfg = parseWorkerConfig({ ...baseEnv, MAX_OCR_ATTEMPTS: '5', INGEST_BATCH: '250' });
    expect(cfg.maxOcrAttempts).toBe(5);
    expect(cfg.ingestBatch).toBe(250);
  });

  it('refuse une configuration incomplète', () => {
    const env: Record<string, string> = { ...baseEnv };
    delete env.GEMINI_API_KEY;
    expect(() => parseWorkerConfig(env)).toThrow();
  });
});
