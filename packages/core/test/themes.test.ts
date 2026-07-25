import { describe, expect, it } from 'vitest';
import { SECTION_AUTRE, TAXONOMIE, blocTaxonomie, verifieThemes } from '../src/themes.js';
import { estPageSommaire } from '../src/structuring.js';

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
