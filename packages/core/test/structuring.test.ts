import { describe, expect, it } from 'vitest';
import {
  buildStructurationPrompt,
  fatwaIdFrom,
  normaliseNumeroFatwa,
  parseStructurationJson,
  sanitizeIdPart,
} from '../src/structuring.js';

describe('parseStructurationJson', () => {
  it('parse et normalise en camelCase', () => {
    const result = parseStructurationJson(
      JSON.stringify({
        fatwas_completes: [
          {
            numero_fatwa: ' ١٢ ',
            sujet_principal: 'الزكاة ',
            sous_sujet: '',
            texte_complet: ' نص الفتوى الكامل ',
          },
        ],
        fatwa_ouverte: {
          numero_fatwa: '13',
          sujet_principal: '',
          sous_sujet: '',
          texte_partiel: 'بداية فتوى مقطوعة',
        },
      }),
    );
    expect(result.fatwasCompletes).toHaveLength(1);
    expect(result.fatwasCompletes[0]?.numero).toBe('١٢');
    expect(result.fatwasCompletes[0]?.texteComplet).toBe('نص الفتوى الكامل');
    expect(result.fatwaOuverte?.textePartiel).toBe('بداية فتوى مقطوعة');
  });

  it('tolère les clôtures markdown et les champs manquants', () => {
    const result = parseStructurationJson('```json\n{"fatwas_completes":[]}\n```');
    expect(result.fatwasCompletes).toEqual([]);
    expect(result.fatwaOuverte).toBeNull();
  });

  it('rejette une fatwa sans texte', () => {
    expect(() =>
      parseStructurationJson(JSON.stringify({ fatwas_completes: [{ numero_fatwa: '1' }] })),
    ).toThrow();
  });
});

describe('buildStructurationPrompt', () => {
  it('inclut le fragment en attente quand il existe', () => {
    const prompt = buildStructurationPrompt({
      titreLivre: 'Recueil',
      numeroPage: 13,
      textePage: 'suite du texte',
      fragment: {
        numero: '12',
        sujetPrincipal: '',
        sousSujet: '',
        textePartiel: 'début coupé',
        pages: [],
      },
    });
    expect(prompt).toContain('FRAGMENT EN ATTENTE');
    expect(prompt).toContain('début coupé');
    expect(prompt).toContain('PAGE 13');
  });
  it('sans fragment, pas de bloc fragment', () => {
    const prompt = buildStructurationPrompt({
      titreLivre: 'Recueil',
      numeroPage: 1,
      textePage: 'texte',
      fragment: null,
    });
    expect(prompt).not.toContain('FRAGMENT EN ATTENTE');
  });
});

describe('identifiants de fatwas', () => {
  it('normalise les chiffres arabes', () => {
    expect(normaliseNumeroFatwa(' ١٢٣ ')).toBe('123');
  });
  it('sanitize les caractères interdits de Firestore', () => {
    expect(sanitizeIdPart('12 / 34 [a]')).toBe('12-34-a');
  });
  it('construit un ID déterministe, avec repli sans numéro', () => {
    expect(fatwaIdFrom('livreA', '١٢', 'p0001-0')).toBe('livreA_12');
    expect(fatwaIdFrom('livreA', '', 'p0001-0')).toBe('livreA_p0001-0');
  });
});
