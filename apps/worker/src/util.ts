import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { WorkerConfig, WorkerTasksRuntime } from '@fataawa/core';

/** Express 4 ne rattrape pas les rejets async : wrapper systématique des handlers. */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function tasksRuntime(cfg: WorkerConfig): WorkerTasksRuntime {
  return {
    project: cfg.project,
    region: cfg.region,
    workerUrl: cfg.workerUrl,
    serviceAccountEmail: cfg.tasksServiceAccountEmail,
  };
}
