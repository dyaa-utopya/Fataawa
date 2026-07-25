import { describe, expect, it } from 'vitest';
import {
  GeminiUnusableError,
  ensureUsableOcr,
  parseGenerateContent,
  parseRetryAfterMs,
} from '../src/gemini.js';

describe('parseGenerateContent', () => {
  it('concatène les parts texte du premier candidat', () => {
    const parsed = parseGenerateContent({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'بسم الله ' }, { text: 'الرحمن الرحيم' }] },
        },
      ],
    });
    expect(parsed.text).toBe('بسم الله الرحمن الرحيم');
    expect(parsed.finishReason).toBe('STOP');
  });

  it('remonte finishReason RECITATION', () => {
    const parsed = parseGenerateContent({ candidates: [{ finishReason: 'RECITATION' }] });
    expect(parsed.finishReason).toBe('RECITATION');
    expect(parsed.text).toBe('');
  });

  it('remonte le blocage prompt', () => {
    const parsed = parseGenerateContent({ promptFeedback: { blockReason: 'SAFETY' } });
    expect(parsed.blockReason).toBe('SAFETY');
  });

  it('résiste aux réponses vides ou malformées', () => {
    expect(parseGenerateContent({}).text).toBe('');
    expect(parseGenerateContent(null).text).toBe('');
    expect(parseGenerateContent({ candidates: [] }).text).toBe('');
  });
});

describe('ensureUsableOcr', () => {
  it('rend le texte quand tout va bien', () => {
    expect(ensureUsableOcr({ text: 'نص', finishReason: 'STOP' })).toBe('نص');
  });
  it.each([
    [{ text: '', finishReason: 'RECITATION' }],
    [{ text: 'x', blockReason: 'SAFETY' }],
    [{ text: '', finishReason: 'STOP' }],
    [{ text: 'y', finishReason: 'SAFETY' }],
  ])('lève GeminiUnusableError pour %j', (parsed) => {
    expect(() => ensureUsableOcr(parsed)).toThrow(GeminiUnusableError);
  });
});

describe('parseRetryAfterMs', () => {
  it('interprète les secondes', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });
  it('interprète une date HTTP future', () => {
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfterMs(inTenSeconds);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(10_000);
  });
  it('retourne undefined sinon', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('n/a')).toBeUndefined();
  });
});
