import { jeton } from './auth.js';
import type { AskResponse } from './types.js';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export async function ask(
  question: string,
  conversationId: string | null,
  langue: string,
  questionConfirmee = false,
): Promise<AskResponse> {
  const token = await jeton();
  if (token === null) throw new ApiError(401);
  const res = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question,
      ...(conversationId ? { conversationId } : {}),
      langue,
      questionConfirmee,
    }),
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as AskResponse;
}
