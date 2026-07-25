import { CloudTasksClient } from '@google-cloud/tasks';

let client: CloudTasksClient | undefined;

function tasks(): CloudTasksClient {
  client ??= new CloudTasksClient();
  return client;
}

export interface WorkerTasksRuntime {
  project: string;
  region: string;
  workerUrl: string;
  serviceAccountEmail: string;
}

export type WorkerTaskPath =
  | '/tasks/ingestion'
  | '/tasks/ocr-page'
  | '/tasks/structurer'
  | '/tasks/embed'
  | '/tasks/reembed';

/**
 * Enfile une tâche HTTP vers le worker (jeton OIDC). Pas de nom de tâche :
 * tous les handlers sont idempotents, les doublons sont sans effet ; le
 * lissage de débit et les retries sont portés par la configuration des queues.
 */
export async function enqueueWorkerTask(
  rt: WorkerTasksRuntime,
  queue: string,
  path: WorkerTaskPath,
  payload: unknown,
  delaySeconds = 0,
): Promise<void> {
  const c = tasks();
  await c.createTask({
    parent: c.queuePath(rt.project, rt.region, queue),
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${rt.workerUrl}${path}`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)),
        oidcToken: {
          serviceAccountEmail: rt.serviceAccountEmail,
          audience: rt.workerUrl,
        },
      },
      ...(delaySeconds > 0
        ? { scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds } }
        : {}),
    },
  });
}
