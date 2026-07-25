import { describe, expect, it } from 'vitest';
import {
  CHAMP_EMBEDDING_ACTUEL,
  CHAMP_EMBEDDING_LEGACY,
  fromPipeline,
  texteAEmbedder,
  toFatwa,
} from '../src/fatwas.js';

describe('toFatwa (collection historique fatawas_db)', () => {
  it('lit une fatwa historique', () => {
    const f = toFatwa('FATWA-000559A6', {
      texte_arabe: 'نص الفتوى',
      sujet_principal: 'العقيدة',
      sous_sujet: 'الماسونية',
      numero_fatwa: '893',
      numero_page: '445',
      image_source: 'recueil_Page445.png',
    });
    expect(f.texte).toBe('نص الفتوى');
    expect(f.numero).toBe('893');
    expect(f.numeroPage).toBe(445);
    expect(f.imageSource).toBe('recueil_Page445.png');
    expect(f.livreId).toBe('');
    expect(f.pages).toEqual([]);
  });

  it('lit une fatwa du pipeline', () => {
    const f = toFatwa('livreA_12', {
      texte_arabe: 'نص',
      livre_id: 'livreA',
      numero_fatwa: '12',
      pages: [{ numero: 7, pageId: '0007', gcsPath: 'livres/livreA/pages/0007.png' }],
    });
    expect(f.livreId).toBe('livreA');
    expect(f.pages[0]?.gcsPath).toBe('livres/livreA/pages/0007.png');
  });

  it('tolère les champs absents et un numéro de page non numérique', () => {
    const f = toFatwa('x', { numero_page: '؟' });
    expect(f.texte).toBe('');
    expect(f.numeroPage).toBeNull();
  });
});

describe('texteAEmbedder', () => {
  it('concatène sujets puis texte, en sautant les vides', () => {
    const f = toFatwa('x', { texte_arabe: 'نص', sujet_principal: 'الزكاة', sous_sujet: '' });
    expect(texteAEmbedder(f)).toBe('الزكاة\nنص');
  });
});

describe('fromPipeline', () => {
  it('écrit les noms de champs de la collection historique', () => {
    const stored = fromPipeline({
      livreId: 'livreA',
      numero: '12',
      sujetPrincipal: 'الزكاة',
      sousSujet: 'النصاب',
      texte: 'نص كامل',
      question: 'نص السؤال',
      reponse: 'نص الجواب',
      pages: [{ numero: 7, pageId: '0007', gcsPath: 'livres/livreA/pages/0007.png' }],
    });
    expect(stored.question_arabe).toBe('نص السؤال');
    expect(stored.reponse_arabe).toBe('نص الجواب');
    expect(stored.sous_question).toBe('');
    expect(stored.texte_arabe).toBe('نص كامل');
    expect(stored.sujet_principal).toBe('الزكاة');
    expect(stored.numero_fatwa).toBe('12');
    expect(stored.numero_page).toBe('7');
    expect(stored.gcs_path).toBe('livres/livreA/pages/0007.png');
    expect(stored.statut).toBe('STRUCTUREE');
    // jamais d'écriture dans le champ vectoriel historique
    expect(stored).not.toHaveProperty(CHAMP_EMBEDDING_LEGACY);
    expect(stored).not.toHaveProperty(CHAMP_EMBEDDING_ACTUEL);
  });

  it('sans page source, laisse les champs de page vides', () => {
    const stored = fromPipeline({
      livreId: 'l',
      numero: '',
      sujetPrincipal: '',
      sousSujet: '',
      texte: 't',
      pages: [],
    });
    expect(stored.numero_page).toBe('');
    expect(stored.gcs_path).toBe('');
  });
});
