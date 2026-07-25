import type { NextFunction, Request, RequestHandler, Response } from 'express';

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
