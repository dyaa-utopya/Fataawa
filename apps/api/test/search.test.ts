import { describe, expect, it } from 'vitest';
import { ordonnerCandidats, origineResultat, searchRequestSchema } from '../src/search.js';

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

describe('origineResultat', () => {
  const ids = {
    exacts: new Set(['x']),
    lexicaux: new Set(['a', 'b']),
    semantiques: new Set(['b', 'c']),
  };

  it('nomme le chemin qui a fait remonter chaque résultat', () => {
    expect(origineResultat('x', ids)).toBe('numero');
    expect(origineResultat('a', ids)).toBe('mots');
    expect(origineResultat('c', ids)).toBe('sens');
    expect(origineResultat('b', ids)).toBe('mots+sens');
  });

  it('fait primer le numéro exact sur les autres chemins', () => {
    const chevauche = { ...ids, exacts: new Set(['b']) };
    expect(origineResultat('b', chevauche)).toBe('numero');
  });
});

describe('ordonnerCandidats', () => {
  const d = (id: string) => ({ id });

  it('place le numéro exact devant, sans le répéter dans la fusion', () => {
    const ordre = ordonnerCandidats([d('n')], [d('n'), d('a')], [d('b'), d('n')]).map((x) => x.id);
    expect(ordre[0]).toBe('n');
    expect(ordre.filter((x) => x === 'n')).toHaveLength(1);
  });

  it('remonte ce que les deux chemins retiennent', () => {
    // « b » n'est premier sur aucune liste, mais figure sur les deux : c'est
    // exactement ce que la fusion de rangs est censée récompenser
    const ordre = ordonnerCandidats([], [d('a'), d('b')], [d('c'), d('b')]).map((x) => x.id);
    expect(ordre[0]).toBe('b');
  });

  it('se contente d’un seul chemin quand l’autre ne rend rien', () => {
    expect(ordonnerCandidats([], [], [d('c'), d('d')]).map((x) => x.id)).toEqual(['c', 'd']);
    expect(ordonnerCandidats([], [d('a')], []).map((x) => x.id)).toEqual(['a']);
    expect(ordonnerCandidats<{ id: string }>([], [], [])).toEqual([]);
  });
});
