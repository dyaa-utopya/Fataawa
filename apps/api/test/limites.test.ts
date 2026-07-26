import { describe, expect, it } from 'vitest';
import { askRequestSchema } from '../src/rag.js';
import { TokenBucketLimiter } from '../src/ratelimit.js';

describe('askRequestSchema — longueur de la question', () => {
  it('accepte 500 caractères', () => {
    expect(askRequestSchema.parse({ question: 'ا'.repeat(500) }).question).toHaveLength(500);
  });

  it('refuse au-delà : la borne du front ne suffit pas, le client peut mentir', () => {
    expect(() => askRequestSchema.parse({ question: 'ا'.repeat(501) })).toThrow();
  });

  it('compte après nettoyage des espaces', () => {
    expect(askRequestSchema.parse({ question: `  ${'ا'.repeat(500)}  ` }).question).toHaveLength(500);
  });
});

describe('TokenBucketLimiter', () => {
  it('laisse passer la rafale puis coupe', () => {
    const l = new TokenBucketLimiter(12, 6);
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) expect(l.allow('ip', t0), `requête ${i + 1}`).toBe(true);
    expect(l.allow('ip', t0)).toBe(false);
  });

  it('se recharge au débit annoncé', () => {
    const l = new TokenBucketLimiter(12, 6);
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) l.allow('ip', t0);
    // 12 par minute : cinq secondes rendent un jeton
    expect(l.allow('ip', t0 + 4_000)).toBe(false);
    expect(l.allow('ip', t0 + 5_500)).toBe(true);
  });

  it('compte chaque IP séparément', () => {
    const l = new TokenBucketLimiter(12, 1);
    const t0 = 1_000_000;
    expect(l.allow('a', t0)).toBe(true);
    expect(l.allow('a', t0)).toBe(false);
    expect(l.allow('b', t0)).toBe(true);
  });
});
