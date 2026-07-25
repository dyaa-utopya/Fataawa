/**
 * Taxonomie des thèmes, sur trois niveaux.
 *
 * L'ancien pipeline laissait le modèle nommer librement le thème : la
 * collection en service porte 105 valeurs distinctes de `sujet_principal`
 * (dont « - », « غير محدد », « مقدمة », et les doublons الصوم / الصيام) et
 * 3 437 valeurs de `sous_sujet`. Inexploitable pour filtrer ou naviguer.
 *
 * D'où trois niveaux aux règles différentes :
 *  - niveau 1 : chapitre, OBLIGATOIRE, pris dans la liste fermée ci-dessous ;
 *  - niveau 2 : section, OBLIGATOIRE, prise dans la liste du chapitre choisi ;
 *  - niveau 3 : sujet précis, OBLIGATOIRE, libre — deux à cinq mots, en arabe.
 *
 * Le niveau 3 reste libre à dessein : fermer la liste à ce grain exigerait des
 * milliers d'entrées et ferait retomber le modèle dans l'à-peu-près. Ce sont
 * les deux premiers niveaux qui portent la navigation.
 */
export interface Chapitre {
  /** Libellé de niveau 1, tel qu'il sera enregistré. */
  nom: string;
  /** Sections de niveau 2 admises sous ce chapitre. */
  sections: string[];
}

/** Section de repli, quand aucune section du chapitre ne convient. */
export const SECTION_AUTRE = 'مسائل أخرى';

export const TAXONOMIE: Chapitre[] = [
  {
    nom: 'العقيدة',
    sections: [
      'التوحيد وأقسامه',
      'الشرك ووسائله',
      'الأسماء والصفات',
      'الإيمان بالقضاء والقدر',
      'الإيمان باليوم الآخر',
      'البدع والمحدثات',
      'الولاء والبراء',
      'السحر والكهانة والرقية',
      'الفرق والمذاهب',
      'نواقض الإسلام والردة',
    ],
  },
  {
    nom: 'القرآن وعلومه',
    sections: ['التفسير', 'أحكام التلاوة والتجويد', 'حفظ المصحف وآدابه', 'علوم القرآن'],
  },
  {
    nom: 'الحديث وعلومه',
    sections: ['مصطلح الحديث', 'تخريج الأحاديث ودرجتها', 'السيرة النبوية', 'الأحاديث الموضوعة'],
  },
  {
    nom: 'الطهارة',
    sections: ['المياه وأحكامها', 'الوضوء', 'نواقض الوضوء', 'الغسل والجنابة', 'التيمم', 'الحيض والنفاس', 'إزالة النجاسة'],
  },
  {
    nom: 'الصلاة',
    sections: [
      'المواقيت والأذان',
      'شروط الصلاة وأركانها',
      'صفة الصلاة',
      'صلاة الجماعة والإمامة',
      'صلاة الجمعة',
      'سجود السهو والتلاوة',
      'صلاة المسافر والجمع والقصر',
      'صلاة التطوع والنوافل',
      'صلاة العيدين والاستسقاء والكسوف',
      'المساجد وأحكامها',
    ],
  },
  { nom: 'الجنائز', sections: ['المحتضر والغسل والتكفين', 'صلاة الجنازة', 'الدفن والمقابر', 'التعزية والعزاء', 'زيارة القبور'] },
  { nom: 'الزكاة', sections: ['زكاة النقدين', 'زكاة عروض التجارة', 'زكاة الزروع والثمار', 'زكاة بهيمة الأنعام', 'مصارف الزكاة', 'زكاة الفطر', 'الصدقة والتطوع'] },
  { nom: 'الصيام', sections: ['ثبوت الشهر ورؤية الهلال', 'مفسدات الصوم', 'أعذار الفطر والقضاء', 'الكفارات', 'قيام رمضان والاعتكاف', 'صيام التطوع'] },
  { nom: 'الحج والعمرة', sections: ['الإحرام والمواقيت', 'مناسك الحج', 'العمرة', 'محظورات الإحرام والفدية', 'الهدي والأضحية', 'زيارة المسجد النبوي'] },
  { nom: 'المعاملات', sections: ['البيوع', 'الربا والبنوك', 'الإجارة والعمل', 'الشركات والاستثمار', 'الديون والرهن', 'التأمين', 'الوقف والوصية', 'المواريث'] },
  { nom: 'النكاح والأسرة', sections: ['الخطبة وعقد النكاح', 'المحرمات من النساء', 'الصداق والوليمة', 'العشرة بين الزوجين', 'الطلاق والخلع', 'العدة والنفقة', 'الحضانة وتربية الأولاد'] },
  { nom: 'الأطعمة واللباس والزينة', sections: ['الأطعمة والأشربة', 'الذبائح والصيد', 'اللباس والحجاب', 'الزينة والتجمل', 'التصوير والصور'] },
  { nom: 'الآداب والأخلاق', sections: ['الأذكار والأدعية', 'آداب المجالس والكلام', 'الأعياد والمناسبات', 'التعامل مع غير المسلمين', 'الدعوة إلى الله', 'الأخلاق والمعاملة'] },
  { nom: 'الجنايات والقضاء', sections: ['الحدود', 'القصاص والديات', 'القضاء والشهادة', 'الأيمان والنذور', 'الولاية والإمارة'] },
];

const PAR_NOM = new Map(TAXONOMIE.map((c) => [c.nom, c]));

/** Retire diacritiques, tatweel et variantes de hamza pour comparer deux libellés. */
function forme(v: string): string {
  return v
    .normalize('NFC')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

const PAR_FORME = new Map(TAXONOMIE.map((c) => [forme(c.nom), c]));

export interface ThemesVerifies {
  niveau1: string;
  niveau2: string;
  niveau3: string;
  /** Les trois niveaux sont renseignés et les deux premiers sont dans la taxonomie. */
  complet: boolean;
}

/**
 * Ramène ce que le modèle a répondu sur la taxonomie, sans jamais inventer :
 * un libellé hors liste est effacé et la fatwa ressort « incomplète », à
 * charge du rapport de la signaler. Mieux vaut un thème vide, visible, qu'un
 * thème plausible et faux.
 */
export function verifieThemes(n1: string, n2: string, n3: string): ThemesVerifies {
  const chapitre = PAR_NOM.get(n1.trim()) ?? PAR_FORME.get(forme(n1));
  if (!chapitre) return { niveau1: '', niveau2: '', niveau3: n3.trim(), complet: false };

  const cible = forme(n2);
  const section =
    chapitre.sections.find((s) => s === n2.trim()) ??
    chapitre.sections.find((s) => forme(s) === cible) ??
    (forme(SECTION_AUTRE) === cible ? SECTION_AUTRE : '');
  const niveau3 = n3.trim();
  return {
    niveau1: chapitre.nom,
    niveau2: section,
    niveau3,
    complet: section !== '' && niveau3 !== '',
  };
}

/** Bloc de taxonomie injecté dans le prompt de structuration. */
export function blocTaxonomie(): string {
  return TAXONOMIE.map((c) => `- ${c.nom} : ${c.sections.join(' / ')}`).join('\n');
}
