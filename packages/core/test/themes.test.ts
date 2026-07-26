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
  const EN_TETE = 'فتاوى اللجنة الدائمة للبحوث العلمية والإفتاء\n';
  const CLOTURE = '\nوبالله التوفيق وصلى الله على نبينا محمد وآله وصحبه وسلم.';
  const question = 'س١٤: إذا عطس أو تثاءب شخص في الصلاة فهل يحمد الله للعطاس ويستعيذ بالله من الشيطان للتثاؤب؟ ';
  const reponse =
    'ج١٤: من عطس أو تثاءب في الصلاة يحمد الله للعطاس، ولا يستعيذ بالله من الشيطان لتثاؤبه، ' +
    'لعدم ورود ذلك، ولا يجيب من شمته لعطاسه حال كونه في صلاته ولا يرد السلام على من سلم عليه ' +
    'وهو في الصلاة إلا بالإشارة، لعموم ما ثبت من قوله: إن في الصلاة لشغلا، ولحديث معاوية بن الحكم ' +
    'حين شمت عاطسا في الصلاة فرماه القوم بأبصارهم.';
  const fatwa = question + reponse;
  const coupe = Math.floor(reponse.length / 2);

  // le livre tel qu'il est imprimé : chaque page porte l'en-tête courant, la
  // fatwa est à cheval sur deux d'entre elles
  const livre = [
    { ref: 30, numero: 30, texte: `${EN_TETE}فتوى précédente sans rapport، عن موضوع آخر${CLOTURE}` },
    { ref: 31, numero: 31, texte: `${EN_TETE}${question}${reponse.slice(0, coupe)}` },
    { ref: 32, numero: 32, texte: `${EN_TETE}${reponse.slice(coupe)}${CLOTURE}` },
    { ref: 33, numero: 33, texte: `${EN_TETE}fatwa suivante، مسألة أخرى تماما${CLOTURE}` },
  ];

  it('suit la fatwa d’une page à l’autre', () => {
    expect(pagesCouvertes(fatwa, livre, 31)).toEqual([31, 32]);
  });

  it('ne déborde pas sur les pages voisines, malgré l’en-tête qu’elles partagent', () => {
    // l'en-tête courant et la formule de clôture sont sur toutes les pages :
    // c'est ce décor qui faisait ressortir une fatwa de 900 caractères sur
    // sept pages quand on mesurait un simple recouvrement
    const trouve = pagesCouvertes(fatwa, livre, 31);
    expect(trouve).not.toContain(30);
    expect(trouve).not.toContain(33);
  });

  it('rend une seule page quand la fatwa y tient tout entière', () => {
    const seule = [
      { ref: 10, numero: 10, texte: `${EN_TETE}autre fatwa${CLOTURE}` },
      { ref: 11, numero: 11, texte: `${EN_TETE}${fatwa}${CLOTURE}` },
      { ref: 12, numero: 12, texte: `${EN_TETE}suite du livre${CLOTURE}` },
    ];
    expect(pagesCouvertes(fatwa, seule, 11)).toEqual([11]);
  });

  it('suit une fatwa longue sur cinq pages', () => {
    // 27 fatwas du corpus en occupent cinq, quatre en occupent six, une sept.
    // Chaque page porte un texte distinct : c'est ce qui permet de la situer.
    const mots = [
      'الطهارة والوضوء والغسل والتيمم وإزالة النجاسة عن الثوب والبدن والمكان',
      'الصلاة وشروطها وأركانها وواجباتها وسننها ومبطلاتها وسجود السهو',
      'الزكاة ونصابها ومصارفها وزكاة الفطر وزكاة عروض التجارة والأنعام',
      'الصيام ومفسداته وأعذار الفطر والقضاء والكفارة وقيام رمضان والاعتكاف',
      'الحج والعمرة والإحرام والمواقيت والمناسك ومحظورات الإحرام والفدية',
    ];
    const morceaux = mots.map((m, i) => `${m} في الفقرة رقم ${String(i)} ${m} مرة أخرى ${m}`);
    const longue = morceaux.join(' ');
    const pages = morceaux.map((m, i) => ({
      ref: 100 + i,
      numero: 100 + i,
      texte: `${EN_TETE}${m}`,
    }));
    expect(pagesCouvertes(longue, pages, 100)).toEqual([100, 101, 102, 103, 104]);
  });

  it('se rabat sur la page de départ quand le texte ne se retrouve pas', () => {
    expect(
      pagesCouvertes('نص introuvable dans le livre '.repeat(4), livre, 31),
    ).toEqual([31]);
  });
});
