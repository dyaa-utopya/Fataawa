import { describe, expect, it } from 'vitest';
import { parseEmbedContent } from '../src/embeddings.js';

describe('parseEmbedContent', () => {
  it('extrait le vecteur', () => {
    expect(parseEmbedContent({ embedding: { values: [0.1, 0.2, 0.3] } })).toEqual([0.1, 0.2, 0.3]);
  });
  it.each([[{}], [null], [{ embedding: { values: [] } }], [{ embedding: { values: ['a'] } }]])(
    'rejette une réponse invalide %j',
    (json) => {
      expect(() => parseEmbedContent(json)).toThrow();
    },
  );
});
