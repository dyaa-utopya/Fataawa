import { describe, expect, it } from 'vitest';
import { searchRequestSchema } from '../src/search.js';

describe('searchRequestSchema', () => {
  it('applique une limite par défaut', () => {
    expect(searchRequestSchema.parse({ requete: 'الزكاة' })).toEqual({
      requete: 'الزكاة',
      limite: 15,
    });
  });

  it('nettoie les espaces autour de la requête', () => {
    expect(searchRequestSchema.parse({ requete: '  صلاة الجمعة  ' }).requete).toBe('صلاة الجمعة');
  });

  it('refuse une requête trop courte : un caractère ne cherche rien', () => {
    expect(() => searchRequestSchema.parse({ requete: 'ا' })).toThrow();
    expect(() => searchRequestSchema.parse({ requete: '   ' })).toThrow();
  });

  it('borne la limite : pas de balayage complet du corpus', () => {
    expect(() => searchRequestSchema.parse({ requete: 'zakat', limite: 200 })).toThrow();
    expect(searchRequestSchema.parse({ requete: 'zakat', limite: 30 }).limite).toBe(30);
  });
});
