import { describe, expect, it } from 'vitest';
import { LIMITE_VOCALISATION } from '@fataawa/core';
import { vocalisationRequestSchema } from '../src/voyelles.js';

describe('vocalisationRequestSchema', () => {
  it('accepte un texte arabe ordinaire', () => {
    expect(vocalisationRequestSchema.parse({ texte: 'الحمد لله' }).texte).toBe('الحمد لله');
  });

  it('nettoie les espaces de bord sans toucher à l’intérieur', () => {
    // l'intérieur est intouchable : les retours à la ligne portent la mise en
    // page, que le recollage restitue telle quelle
    expect(vocalisationRequestSchema.parse({ texte: '  الحمد\n\nلله  ' }).texte).toBe(
      'الحمد\n\nلله',
    );
  });

  it('refuse le vide et le caractère isolé', () => {
    expect(() => vocalisationRequestSchema.parse({ texte: '' })).toThrow();
    expect(() => vocalisationRequestSchema.parse({ texte: '   ' })).toThrow();
    expect(() => vocalisationRequestSchema.parse({ texte: 'ا' })).toThrow();
  });

  it('borne à trois pages : au-delà, la génération devient très longue', () => {
    const limite = 'ا'.repeat(LIMITE_VOCALISATION);
    expect(vocalisationRequestSchema.parse({ texte: limite }).texte).toHaveLength(
      LIMITE_VOCALISATION,
    );
    expect(() => vocalisationRequestSchema.parse({ texte: `${limite}ا` })).toThrow();
  });
});
