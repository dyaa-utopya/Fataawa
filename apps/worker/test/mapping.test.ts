import { describe, expect, it } from 'vitest';
import { colIndex, parseMapping, rowToLigne } from '../src/jobs/mapping.js';

describe('colIndex', () => {
  it('convertit les lettres de colonnes', () => {
    expect(colIndex('A')).toBe(0);
    expect(colIndex('E')).toBe(4);
    expect(colIndex('Z')).toBe(25);
    expect(colIndex('AA')).toBe(26);
    expect(colIndex(' b ')).toBe(1);
  });
  it('rejette les valeurs invalides', () => {
    expect(() => colIndex('3')).toThrow();
    expect(() => colIndex('')).toThrow();
  });
});

describe('parseMapping', () => {
  it('parse le mapping par défaut', () => {
    const m = parseMapping('id=A,sujet=B,sousSujet=C,numero=D,texte=E');
    expect(m).toEqual({ id: 0, sujet: 1, sousSujet: 2, numero: 3, texte: 4 });
  });
  it('exige la colonne texte', () => {
    expect(() => parseMapping('id=A,sujet=B')).toThrow(/texte/);
  });
  it('rejette un champ inconnu', () => {
    expect(() => parseMapping('texte=E,bidule=F')).toThrow(/inconnu/);
  });
});

describe('rowToLigne', () => {
  const mapping = parseMapping('id=A,sujet=B,sousSujet=C,numero=D,texte=E');
  it('extrait les champs et trim', () => {
    const ligne = rowToLigne(['F-12 ', ' الزكاة', 'النصاب', ' ١٢ ', ' نص الفتوى '], mapping);
    expect(ligne).toEqual({
      id: 'F-12',
      livre: '',
      sujet: 'الزكاة',
      sousSujet: 'النصاب',
      numero: '١٢',
      texte: 'نص الفتوى',
    });
  });
  it('retourne null sans texte', () => {
    expect(rowToLigne(['id', 'sujet', '', '', ''], mapping)).toBeNull();
    expect(rowToLigne([], mapping)).toBeNull();
  });
  it('tolère les cellules non-string', () => {
    const ligne = rowToLigne([42, 'sujet', '', 7, 'texte'], mapping);
    expect(ligne?.id).toBe('42');
    expect(ligne?.numero).toBe('7');
  });
});
