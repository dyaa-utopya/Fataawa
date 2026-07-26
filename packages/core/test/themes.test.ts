import { describe, expect, it } from 'vitest';
import { SECTION_AUTRE, TAXONOMIE, blocTaxonomie, verifieThemes } from '../src/themes.js';
import { estPageSommaire, pagesCouvertes } from '../src/structuring.js';

describe('taxonomie', () => {
  it('n’a ni chapitre ni section en double', () => {
    const noms = TAXONOMIE.map((c) => c.nom);
    expect(new Set(noms).size).toBe(noms.length);
    for (const c of TAXONOMIE) {
      expect(new Set(c.sections).size, `sections de ${c.nom}`).toBe(c.sections.length);
      expect(c.sections.length).toBeGreaterThan(0);
    }
  });
  it('se rend sous une forme lisible par le modèle', () => {
    const bloc = blocTaxonomie();
    expect(bloc).toContain('الزكاة');
    expect(bloc).toContain('زكاة الفطر');
  });
});

describe('verifieThemes', () => {
  it('accepte un couple chapitre / section de la taxonomie', () => {
    const r = verifieThemes('الزكاة', 'زكاة الفطر', 'مقدار زكاة الفطر');
    expect(r).toEqual({
      niveau1: 'الزكاة',
      niveau2: 'زكاة الفطر',
      niveau3: 'مقدار زكاة الفطر',
      complet: true,
    });
  });

  it('tolère diacritiques et variantes d’écriture', () => {
    // le modèle rend « الزكاه » ou « الصلوة » selon les pages : même chapitre
    expect(verifieThemes('الزكاه', 'زكاة الفطر', 'س').niveau1).toBe('الزكاة');
  });

  it('accepte la section de repli', () => {
    const r = verifieThemes('الصلاة', SECTION_AUTRE, 'مسألة نادرة');
    expect(r.niveau2).toBe(SECTION_AUTRE);
    expect(r.complet).toBe(true);
  });

  it('efface un chapitre inventé plutôt que de le rapprocher de force', () => {
    const r = verifieThemes('الطب النبوي', 'شيء ما', 'موضوع');
    expect(r.niveau1).toBe('');
    expect(r.complet).toBe(false);
  });

  it('efface une section qui n’appartient pas au chapitre choisi', () => {
    // « زكاة الفطر » existe, mais pas sous le chapitre الصلاة
    const r = verifieThemes('الصلاة', 'زكاة الفطر', 'موضوع');
    expect(r.niveau1).toBe('الصلاة');
    expect(r.niveau2).toBe('');
    expect(r.complet).toBe(false);
  });

  it('exige le niveau 3 pour déclarer la fatwa complète', () => {
    expect(verifieThemes('الصلاة', 'صفة الصلاة', '   ').complet).toBe(false);
  });
});

describe('estPageSommaire', () => {
  // relevés tels quels dans le recueil 1 : pages 478-496 sont le فهرس
  const sommaire = [
    'فهرس المجلد الأول من المجموعة الثانية',
    'المقدمة ................................................... أ',
    'تصوير الإبل من أجل عرض صورها على الزبائن ليبيعها .... ٢٩٤',
    'طمس الصور ........................................ ٢٩٦',
    'حكم التصوير الفوتوغرافي ............................ ٢٩٨',
    'الصور المجسمة ..................................... ٣٠١',
    'اقتناء الصور ....................................... ٣٠٣',
  ].join('\n');

  it('reconnaît une page de sommaire', () => {
    expect(estPageSommaire(sommaire)).toBe(true);
  });

  it('laisse passer une page de fatwas', () => {
    const page = [
      '(١٤)',
      'حكم صلاة الجماعة',
      'س: ما حكم صلاة الجماعة في المسجد؟ وهل هي واجبة على الأعيان أم على الكفاية؟',
      'ج: صلاة الجماعة واجبة على الرجال القادرين، لقوله ﷺ: «من سمع النداء فلم يأت فلا صلاة له».',
      'وبالله التوفيق، وصلى الله على نبينا محمد وآله وصحبه وسلم.',
      'اللجنة الدائمة للبحوث العلمية والإفتاء',
      'عضو: عبد الله بن قعود',
    ].join('\n');
    expect(estPageSommaire(page)).toBe(false);
  });

  it('ne se déclenche pas sur une page trop courte pour trancher', () => {
    expect(estPageSommaire('عنوان ١٢\nعنوان ١٣')).toBe(false);
  });
});

describe('estPageSommaire — OCR emballé', () => {
  // 54 pages sur 4 870 sont ressorties de l'OCR à ~131 000 caractères : une
  // répétition sans fin de points de conduite, rendue d'une seule traite.
  // Le comptage par lignes n'y voyait rien, d'où le signal global.
  const emballee = `هل يحضر النبي ﷺ المولد؟ ${' .'.repeat(2000)}`;

  it('reconnaît une page saturée de points, même sur une seule ligne', () => {
    expect(estPageSommaire(emballee)).toBe(true);
  });

  it('ne se déclenche pas sur la ponctuation ordinaire d’une fatwa', () => {
    const fatwa =
      'س: ما حكم صلاة الجماعة؟ ج: صلاة الجماعة واجبة على الرجال القادرين. ' +
      'وقد ثبت عن النبي ﷺ أنه قال: «من سمع النداء فلم يأت فلا صلاة له». وبالله التوفيق.';
    expect(estPageSommaire(fatwa)).toBe(false);
  });
});

describe('pagesCouvertes', () => {
  // Cas réel : la fatwa 2677 question 14 du recueil 7 tient sur deux scans. Le
  // texte enregistré était complet, mais une seule page était référencée — le
  // lecteur voyait donc une réponse coupée en bas de feuille.
  const fatwa =
    'س١٤: إذا عطس أو تثاءب شخص في الصلاة فهل يحمد الله للعطاس ويستعيذ بالله من الشيطان للتثاؤب؟ ' +
    'ج١٤: من عطس أو تثاءب في الصلاة يحمد الله للعطاس، ولا يستعيذ بالله من الشيطان لتثاؤبه، ' +
    'لعدم ورود ذلك، ولا يجيب من شمته لعطاسه حال كونه في صلاته ولا يرد السلام على من سلم عليه ' +
    'وهو في الصلاة إلا بالإشارة، لعموم ما ثبت من قوله: إن في الصلاة لشغلا. وبالله التوفيق.';
  const CLOTURE = 'وبالله التوفيق وصلى الله على نبينا محمد وآله وصحبه وسلم.';

  it('retient les pages dont le texte se retrouve dans la fatwa', () => {
    const debut = fatwa.slice(0, 200);
    const suite = fatwa.slice(200);
    expect(
      pagesCouvertes(
        fatwa,
        [
          { ref: 30, texte: `${CLOTURE} نص sans rapport avec cette fatwa، عن موضوع آخر تماما، ${'ك'.repeat(300)}` },
          { ref: 31, texte: debut },
          { ref: 32, texte: suite },
          { ref: 33, texte: `${CLOTURE} ${'ب'.repeat(400)}` },
        ],
        31,
      ).sort((a, b) => a - b),
    ).toEqual([31, 32]);
  });

  it('ne se laisse pas prendre à la formule de clôture, présente partout', () => {
    // c'est ce piège qui rendait la fin de texte inutilisable comme empreinte
    expect(pagesCouvertes(fatwa, [{ ref: 99, texte: `${CLOTURE} ${'س'.repeat(500)}` }], 1)).toEqual([1]);
  });

  it('garde toujours la page de départ, même sans recouvrement mesurable', () => {
    expect(pagesCouvertes(fatwa, [{ ref: 7, texte: 'ocr illisible' }], 7)).toEqual([7]);
  });
});
