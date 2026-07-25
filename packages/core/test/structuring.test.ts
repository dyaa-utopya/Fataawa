import { describe, expect, it } from 'vitest';
import {
  buildStructurationPrompt,
  commenceDans,
  fatwaIdFrom,
  normaliseNumeroFatwa,
  normaliseSousQuestion,
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
        sousQuestion: 'أ',
        sujetPrincipal: '',
        sousSujet: '',
        textePartiel: 'début coupé',
        pages: [],
      },
    });
    expect(prompt).toContain('FRAGMENT EN ATTENTE');
    expect(prompt).toContain('début coupé');
    expect(prompt).toContain('question أ');
    expect(prompt).toContain('PAGE COURANTE 13');
  });

  it('sans fragment ni contexte, pas de bloc superflu', () => {
    const prompt = buildStructurationPrompt({
      titreLivre: 'Recueil',
      numeroPage: 1,
      textePage: 'texte',
      fragment: null,
    });
    expect(prompt).not.toContain('FRAGMENT EN ATTENTE');
    expect(prompt).not.toContain('CONTEXTE');
  });

  it('ajoute les pages suivantes comme contexte à ne pas extraire', () => {
    const prompt = buildStructurationPrompt({
      titreLivre: 'Recueil',
      numeroPage: 10,
      textePage: 'page dix',
      pagesSuivantes: [
        { numero: 11, texte: 'page onze' },
        { numero: 12, texte: 'page douze' },
      ],
      fragment: null,
    });
    expect(prompt).toContain('PAGE COURANTE 10');
    expect(prompt).toContain('PAGE 11 (CONTEXTE');
    expect(prompt).toContain('page douze');
    // l'ordre compte : la page courante précède son contexte
    expect(prompt.indexOf('page dix')).toBeLessThan(prompt.indexOf('page onze'));
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
  it('distingue les sous-questions d’une même fatwa', () => {
    expect(fatwaIdFrom('livreA', '1881', 'p-0', 'أ')).toBe('livreA_1881_1');
    expect(fatwaIdFrom('livreA', '1881', 'p-0', '٢')).toBe('livreA_1881_2');
    // même fatwa, deux questions → deux documents distincts
    expect(fatwaIdFrom('livreA', '1881', 'p-0', '1')).not.toBe(
      fatwaIdFrom('livreA', '1881', 'p-0', '2'),
    );
    // rejouer la même sous-question réécrit le même document
    expect(fatwaIdFrom('livreA', '1881', 'p-9', '1')).toBe(fatwaIdFrom('livreA', '1881', 'p-3', '1'));
  });
});

describe('commenceDans', () => {
  // cas réel : la fatwa 17382 commence page 363, pas 362 ; elle avait été
  // extraite deux fois parce que le modèle l'avait lue dans le contexte
  const debut363 = 'السؤال الثاني والثالث من الفتوى رقم (١٧٣٨٢) س ٢: كيف يمكن التخلص من الرياء والسمعة';
  const page362 = 'ولا تنخدع بذلك، ولا ينبغي أن يمنعك ذلك من الاستمرار في القراءة بصوتك الجميل. وبالله التوفيق';

  it('accepte la fatwa quand son début est dans la page', () => {
    expect(commenceDans(debut363, `titre علاج الرياء ${debut363} ج ٢: جاهد نفسك`)).toBe(true);
  });
  it('écarte la fatwa vue seulement dans le contexte', () => {
    expect(commenceDans(debut363, page362)).toBe(false);
  });
  it('tolère les écarts de diacritiques et de ponctuation', () => {
    const ocr = 'السُّؤالُ الثَّاني والثَّالثُ مِن الفَتوى رقم ١٧٣٨٢ س٢ كيف يمكن التخلص من الرياء والسمعة';
    expect(commenceDans(debut363, ocr)).toBe(true);
  });
  it('laisse passer un texte trop court pour décider', () => {
    expect(commenceDans('نعم', page362)).toBe(true);
  });
});

describe('normaliseSousQuestion', () => {
  it('ramène les ordinaux arabes à leur rang', () => {
    expect(normaliseSousQuestion('الأول')).toBe('1');
    expect(normaliseSousQuestion('الثاني')).toBe('2');
    expect(normaliseSousQuestion('الخامس')).toBe('5');
  });
  it('ramène les lettres-puces à leur rang', () => {
    expect(normaliseSousQuestion('أ')).toBe('1');
    expect(normaliseSousQuestion('ب')).toBe('2');
    expect(normaliseSousQuestion('(ج)')).toBe('3');
  });
  it('accepte les chiffres, latins comme arabes', () => {
    expect(normaliseSousQuestion('2')).toBe('2');
    expect(normaliseSousQuestion('٣')).toBe('3');
    expect(normaliseSousQuestion('السؤال 4')).toBe('4');
    expect(normaliseSousQuestion('07')).toBe('7');
  });
  it('deux écritures du même repère donnent le même rang', () => {
    // c'est ce qui empêche la même sous-question d'être créée deux fois
    expect(normaliseSousQuestion('الثاني')).toBe(normaliseSousQuestion('٢'));
    expect(normaliseSousQuestion('ب')).toBe(normaliseSousQuestion('2'));
  });
  it('vide reste vide, repère inconnu est conservé', () => {
    expect(normaliseSousQuestion('')).toBe('');
    expect(normaliseSousQuestion('  ')).toBe('');
    expect(normaliseSousQuestion('تكميل')).toBe('تكميل');
  });
});

describe('sous-questions', () => {
  it('extrait plusieurs questions portant le même numéro de fatwa', () => {
    const result = parseStructurationJson(
      JSON.stringify({
        fatwas_completes: [
          {
            numero_fatwa: '1881',
            sous_question: 'الأول',
            sujet_principal: 'الزكاة',
            question: 'نص السؤال الأول',
            reponse: 'نص الجواب الأول',
            texte_complet: 'السؤال الأول والجواب',
          },
          {
            numero_fatwa: '1881',
            sous_question: 'الثاني',
            sujet_principal: 'الصلاة',
            question: 'نص السؤال الثاني',
            reponse: 'نص الجواب الثاني',
            texte_complet: 'السؤال الثاني والجواب',
          },
        ],
      }),
    );
    expect(result.fatwasCompletes).toHaveLength(2);
    expect(result.fatwasCompletes.map((f) => f.numero)).toEqual(['1881', '1881']);
    expect(result.fatwasCompletes.map((f) => f.sousQuestion)).toEqual(['الأول', 'الثاني']);
    // chaque sous-question garde son propre thème
    expect(result.fatwasCompletes[0]?.sujetPrincipal).toBe('الزكاة');
    expect(result.fatwasCompletes[1]?.sujetPrincipal).toBe('الصلاة');
    expect(result.fatwasCompletes[0]?.question).toBe('نص السؤال الأول');
    expect(result.fatwasCompletes[0]?.reponse).toBe('نص الجواب الأول');
  });

  it('sous_question vide quand la fatwa n’a qu’une question', () => {
    const result = parseStructurationJson(
      JSON.stringify({ fatwas_completes: [{ numero_fatwa: '5', texte_complet: 'نص' }] }),
    );
    expect(result.fatwasCompletes[0]?.sousQuestion).toBe('');
  });
});
