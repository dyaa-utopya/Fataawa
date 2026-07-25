import { CloudTasksClient } from '@google-cloud/tasks';
import type { OcrTaskPayload } from './types.js';

let client: CloudTasksClient | undefined;

function tasks(): CloudTasksClient {
  client ??= new CloudTasksClient();
  return client;
}

export interface TaskQueueConfig {
  project: string;
  region: string;
  queue: string;
  workerUrl: string;
  serviceAccountEmail: string;
}

/**
 * Enfile une tâche OCR pour une page. Pas de nom de tâche (le handler est
 * idempotent : il vérifie le statut de la page avant d'agir) ; le lissage de
 * débit et les retries sont portés par la configuration de la queue.
 */
export async function enqueueOcrTask(
  cfg: TaskQueueConfig,
  payload: OcrTaskPayload,
  delaySeconds = 0,
): Promise<void> {
  const c = tasks();
  await c.createTask({
    parent: c.queuePath(cfg.project, cfg.region, cfg.queue),
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${cfg.workerUrl}/tasks/ocr-page`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: cfg.serviceAccountEmail,
          audience: cfg.workerUrl,
        },
      },
      ...(delaySeconds > 0
        ? { scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds } }
        : {}),
    },
  });
}
