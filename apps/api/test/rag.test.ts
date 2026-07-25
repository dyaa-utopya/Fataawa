import { describe, expect, it } from 'vitest';
import {
  type SourceFatwa,
  askRequestSchema,
  buildContexte,
  filtreSources,
  parseAnswer,
  parseTriage,
} from '../src/rag.js';

function source(id: string, numero = ''): SourceFatwa {
  return {
    id,
    livreId: 'livre1',
    numero,
    sujetPrincipal: 'الزكاة',
    sousSujet: '',
    texte: 'نص الفتوى',
    pages: [],
    imageSource: '',
    numeroPage: null,
  };
}

describe('askRequestSchema', () => {
  it('applique la langue par défaut et trim la question', () => {
    const parsed = askRequestSchema.parse({ question: '  la zakat ?  ' });
    expect(parsed.langue).toBe('fr');
    expect(parsed.question).toBe('la zakat ?');
  });
  it('rejette une question trop courte et un conversationId invalide', () => {
    expect(() => askRequestSchema.parse({ question: 'a' })).toThrow();
    expect(() =>
      askRequestSchema.parse({ question: 'question valide', conversationId: 'a/b' }),
    ).toThrow();
  });
  it('questionConfirmee vaut false par défaut', () => {
    expect(askRequestSchema.parse({ question: 'la zakat ?' }).questionConfirmee).toBe(false);
    expect(
      askRequestSchema.parse({ question: 'la zakat ?', questionConfirmee: true }).questionConfirmee,
    ).toBe(true);
  });
});

describe('parseTriage', () => {
  it('parse une question claire', () => {
    const t = parseTriage(
      JSON.stringify({ statut: 'CLAIRE', question_autonome: 'Quelles sont les conditions de la zakat ?' }),
    );
    expect(t.statut).toBe('CLAIRE');
    expect(t.message_clarification).toBe('');
    expect(t.autres_interpretations).toEqual([]);
  });
  it('parse une question ambiguë avec interprétations', () => {
    const t = parseTriage(
      '```json\n' +
        JSON.stringify({
          statut: 'AMBIGUE',
          question_autonome: 'Le vinaigre est-il licite ?',
          message_clarification: 'Votre question est-elle bien celle-ci ?',
          autres_interpretations: ['Le commerce du vinaigre est-il licite ?'],
        }) +
        '\n```',
    );
    expect(t.statut).toBe('AMBIGUE');
    expect(t.autres_interpretations).toHaveLength(1);
  });
  it('rejette un statut inconnu ou une question vide', () => {
    expect(() => parseTriage(JSON.stringify({ statut: 'BOF', question_autonome: 'q' }))).toThrow();
    expect(() => parseTriage(JSON.stringify({ statut: 'CLAIRE', question_autonome: '' }))).toThrow();
  });
});

describe('buildContexte', () => {
  it('numérote les blocs avec fatwa_id', () => {
    const ctx = buildContexte([source('l1_12', '12'), source('l1_13', '13')]);
    expect(ctx).toContain('SOURCE_BLOC_1');
    expect(ctx).toContain('SOURCE_BLOC_2');
    expect(ctx).toContain('fatwa_id: l1_12');
    expect(ctx).toContain('numero_fatwa: 13');
  });
  it('signale l’absence de sources', () => {
    expect(buildContexte([])).toContain('AUCUNE SOURCE');
  });
});

describe('parseAnswer', () => {
  it('parse une réponse JSON avec clôtures', () => {
    const answer = parseAnswer(
      '```json\n{"reponse_utilisateur":"réponse","suggestions_cliquables":["q1"],"sources_utilisees":[{"fatwa_id":"l1_12","citation_arabe":"نص"}]}\n```',
    );
    expect(answer.reponse_utilisateur).toBe('réponse');
    expect(answer.sources_utilisees[0]?.fatwa_id).toBe('l1_12');
  });
  it('rejette une réponse sans texte', () => {
    expect(() => parseAnswer('{"suggestions_cliquables":[]}')).toThrow();
  });
});

describe('filtreSources', () => {
  const sources = [source('l1_12', '12'), source('l1_13', '13')];
  it('associe par fatwa_id puis par numéro, sans doublon', () => {
    const out = filtreSources(
      {
        reponse_utilisateur: 'r',
        suggestions_cliquables: [],
        sources_utilisees: [
          { fatwa_id: 'l1_12', numero_fatwa: '', citation_arabe: 'أ' },
          { fatwa_id: 'inconnu', numero_fatwa: '13', citation_arabe: 'ب' },
          { fatwa_id: 'l1_12', numero_fatwa: '12', citation_arabe: 'doublon' },
        ],
      },
      sources,
    );
    expect(out.map((s) => s.source.id)).toEqual(['l1_12', 'l1_13']);
    expect(out[0]?.citationArabe).toBe('أ');
  });
  it('écarte les sources inventées', () => {
    const out = filtreSources(
      {
        reponse_utilisateur: 'r',
        suggestions_cliquables: [],
        sources_utilisees: [{ fatwa_id: 'fabriquée', numero_fatwa: '99', citation_arabe: 'x' }],
      },
      sources,
    );
    expect(out).toEqual([]);
  });
});
