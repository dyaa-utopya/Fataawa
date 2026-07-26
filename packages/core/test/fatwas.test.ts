import { describe, expect, it } from 'vitest';
import {
  CHAMP_EMBEDDING_ACTUEL,
  CHAMP_EMBEDDING_LEGACY,
  cheminScanLegacy,
  estArtefactSansFatwa,
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
      themeN1: 'الزكاة',
      themeN2: 'زكاة النقدين',
      themeN3: 'نصاب الذهب',
      themesComplets: true,
      texte: 'نص كامل',
      question: 'نص السؤال',
      reponse: 'نص الجواب',
      pages: [{ numero: 7, pageId: '0007', gcsPath: 'livres/livreA/pages/0007.png' }],
    });
    expect(stored.question_arabe).toBe('نص السؤال');
    expect(stored.reponse_arabe).toBe('نص الجواب');
    expect(stored.sous_question).toBe('');
    expect(stored.texte_arabe).toBe('نص كامل');
    // les trois niveaux, plus les deux champs historiques tenus à jour
    expect(stored.theme_n1).toBe('الزكاة');
    expect(stored.theme_n2).toBe('زكاة النقدين');
    expect(stored.theme_n3).toBe('نصاب الذهب');
    expect(stored.themes_complets).toBe(true);
    expect(stored.sujet_principal).toBe('الزكاة');
    expect(stored.sous_sujet).toBe('زكاة النقدين');
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
      themeN1: '',
      themeN2: '',
      themeN3: '',
      themesComplets: false,
      texte: 't',
      pages: [],
    });
    expect(stored.numero_page).toBe('');
    expect(stored.gcs_path).toBe('');
  });
});

describe('estArtefactSansFatwa', () => {
  // tous ces cas sont relevés tels quels dans la collection en service
  it('écarte les lignes de sommaire', () => {
    expect(estArtefactSansFatwa('تفسير سورة الكهف')).toBe(true);
    expect(estArtefactSansFatwa('ائتمام المسافر بالمقيم')).toBe(true);
    expect(estArtefactSansFatwa('موجبات الكفر (الردة)')).toBe(true);
    expect(estArtefactSansFatwa('إبليس من الجن ٥٠٤')).toBe(true);
  });

  it('écarte les numéros de page nus et les points de conduite', () => {
    expect(estArtefactSansFatwa('153')).toBe(true);
    expect(estArtefactSansFatwa('٤٥١ . . . . . . . . .')).toBe(true);
  });

  it('écarte les marqueurs de page vide, crochets compris', () => {
    expect(estArtefactSansFatwa('الصفحة فارغة')).toBe(true);
    expect(estArtefactSansFatwa('[الصفحة فارغة]')).toBe(true);
  });

  it('conserve une fatwa courte dès qu’elle porte un repère de question', () => {
    expect(
      estArtefactSansFatwa('س: هدم المسجد وإعادة بنائه؟ ج: الأصل جواز ذلك، إذا كان لمصلحة.'),
    ).toBe(false);
    expect(estArtefactSansFatwa('الفتوى رقم (٩٩٤٤). س: يوجد بعض المرضى')).toBe(false);
    expect(estArtefactSansFatwa('السؤال الخامس من الفتوى رقم (١٥٠٠)')).toBe(false);
  });

  it('conserve un texte long même sans repère : c’est une suite de fatwa', () => {
    expect(estArtefactSansFatwa('و'.repeat(200))).toBe(false);
  });
});

describe('cheminScanLegacy', () => {
  it('range le scan sous le dossier de son livre', () => {
    expect(cheminScanLegacy('legacy/', 'Recueil_2_Page445.png')).toBe(
      'legacy/Recueil_2/Recueil_2_Page445.png',
    );
  });

  it('normalise le nom : l’ancienne collection l’écrit en forme décomposée', () => {
    // ا + hamza séparé (U+0627 U+0654) d'un côté, أ (U+0623) de l'autre :
    // sans NFC, le nom ne correspond à aucun objet du bucket
    const decompose = 'الأفتاء_1_Page55.png'.normalize('NFD');
    expect(cheminScanLegacy('legacy/', decompose)).toBe(
      'legacy/الأفتاء_1/الأفتاء_1_Page55.png'.normalize('NFC'),
    );
  });

  it('sans numéro de page reconnaissable, laisse le nom à la racine', () => {
    expect(cheminScanLegacy('legacy/', 'scan.png')).toBe('legacy/scan.png');
  });
});
