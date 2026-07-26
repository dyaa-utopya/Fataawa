import { describe, expect, it } from 'vitest';
import {
  fusionnerRangs,
  jetonsRequete,
  jetonsTexte,
  normaliserMot,
  numeroDemande,
  scoreLexical,
} from '../src/lexique.js';

describe('normaliserMot', () => {
  it('retire les diacritiques et le tatweel', () => {
    expect(normaliserMot('الصَّلاةُ')).toBe(normaliserMot('الصلاة'));
    expect(normaliserMot('الصـــلاة')).toBe(normaliserMot('الصلاة'));
  });

  it('ramène les variantes de hamza, la tāʾ marbūṭa et le yāʾ final', () => {
    expect(normaliserMot('أحمد')).toBe(normaliserMot('احمد'));
    expect(normaliserMot('الصلاة')).toBe(normaliserMot('الصلاه'));
    expect(normaliserMot('علىٰ')).toBe(normaliserMot('علي'));
  });

  it('convertit les chiffres arabes en chiffres occidentaux', () => {
    // le numéro est stocké en 2677 mais imprimé ٢٦٧٧ dans le texte : sans cette
    // conversion, les deux graphies ne se rencontrent jamais
    expect(normaliserMot('٢٦٧٧')).toBe('2677');
    expect(normaliserMot('٨٢١٨')).toBe('8218');
  });
});

describe('jetonsTexte', () => {
  it('indexe le mot et sa forme sans article défini', () => {
    expect(jetonsTexte('الزكاة')).toEqual(['الزكاه', 'زكاه']);
  });

  it('ne dépouille pas un mot que l’article rendrait méconnaissable', () => {
    // « الله » réduit à « له » serait un contresens ; c'est aussi un mot vide
    expect(jetonsTexte('الله')).toEqual([]);
  });

  it('écarte les mots vides et les particules', () => {
    const jetons = jetonsTexte('ما حكم الصلاة في السفر');
    expect(jetons).not.toContain('ما');
    expect(jetons).not.toContain('في');
    expect(jetons).toContain('حكم');
    expect(jetons).toContain('صلاه');
    expect(jetons).toContain('سفر');
  });

  it('écarte le décor imprimé sur presque chaque fatwa', () => {
    // en-tête, formule de clôture et bloc de signature : présents dans 71 à
    // 74 % des 3 981 fatwas, ils ne distinguent rien. C'est le même décor qui
    // avait faussé la mesure de l'étendue des fatwas.
    const cloture = 'وبالله التوفيق وصلى الله على نبينا محمد وآله وصحبه وسلم';
    const signature = 'اللجنة الدائمة للبحوث العلمية والإفتاء الرئيس عبدالعزيز بن باز';
    const jetons = jetonsTexte(`الفتوى رقم (٢٦٧٧) ${cloture} ${signature}`);
    // du décor entier il ne doit rester que le numéro
    expect(jetons).toEqual(['2677']);
    // le corpus écrit aussi les noms détachés (10 % contre 31 %) : « عبد » et
    // « بن » tombent alors, mais « العزيز » reste — il n'atteint pas 20 % en
    // jetons, et c'est par ailleurs un nom divin qu'on peut vouloir chercher
    const detachee = jetonsTexte('عبد العزيز بن باز');
    expect(detachee).not.toContain('عبد');
    expect(detachee).not.toContain('بن');
    expect(detachee).not.toContain('باز');
    expect(detachee).toContain('عزيز');
  });

  it('garde les mots de contenu, même très fréquents', () => {
    // « الصلاة » figure dans 43 % du corpus — plus que « اللجنة » (44 %) ou
    // « رئيس » (43 %). Un seuil de fréquence aurait supprimé le mot le plus
    // utile du recueil : le tri se fait par nature, pas par comptage.
    for (const mot of ['الصلاة', 'حكم', 'يجوز', 'العقيدة', 'النبي', 'رسول']) {
      expect(jetonsTexte(mot).length).toBeGreaterThan(0);
    }
  });

  it('dédoublonne et respecte le plafond', () => {
    const texte = Array.from({ length: 50 }, (_, i) => `كلمه${i}`).join(' ');
    expect(jetonsTexte(texte, 10)).toHaveLength(10);
    expect(jetonsTexte('صلاة صلاة صلاة')).toEqual(['صلاه']);
  });
});

describe('jetonsRequete', () => {
  it('garde l’ordre d’écriture et plafonne', () => {
    expect(jetonsRequete('زكاة الذهب')).toEqual(['زكاه', 'الذهب', 'ذهب']);
    expect(jetonsRequete('واحد اثنان ثلاثة اربعة خمسة ستة سبعة', 3)).toHaveLength(3);
  });

  it('trouve le même jeton depuis les deux graphies', () => {
    // c'est la propriété qui fait marcher la recherche : requête et texte
    // passent par la même normalisation
    const doc = jetonsTexte('الفتوى رقم ٢٦٧٧ في الزكاة');
    for (const j of jetonsRequete('الزكاة')) {
      if (j === 'زكاه') expect(doc).toContain(j);
    }
    expect(doc).toContain('2677');
  });
});

describe('numeroDemande', () => {
  it('reconnaît un numéro seul, dans les deux graphies', () => {
    expect(numeroDemande('2677')).toBe('2677');
    expect(numeroDemande('٢٦٧٧')).toBe('2677');
    expect(numeroDemande('رقم ٨٢١٨')).toBe('8218');
    expect(numeroDemande('الفتوى رقم 2677')).toBe('2677');
  });

  it('refuse un nombre noyé dans du texte', () => {
    // ici 1000 est un montant, pas un numéro de fatwa ; le confondre placerait
    // une fatwa sans rapport en tête de liste
    expect(numeroDemande('زكاة 1000 ريال')).toBe('');
    expect(numeroDemande('2677 و 2678')).toBe('');
    expect(numeroDemande('الصلاة')).toBe('');
    expect(numeroDemande('7')).toBe('');
  });
});

describe('scoreLexical', () => {
  it('compte les mots distincts de la requête présents dans la fatwa', () => {
    expect(scoreLexical(['زكاه', 'ذهب', 'حكم'], ['زكاه', 'ذهب'])).toBe(2);
    expect(scoreLexical(['زكاه'], ['زكاه', 'ذهب'])).toBe(1);
    expect(scoreLexical(['صلاه'], ['زكاه'])).toBe(0);
  });
});

describe('fusionnerRangs', () => {
  const cle = (x: { id: string }) => x.id;

  it('place devant ce que les deux listes retiennent', () => {
    const lexical = [{ id: 'b' }, { id: 'a' }];
    const semantique = [{ id: 'c' }, { id: 'b' }];
    expect(fusionnerRangs([lexical, semantique], cle).map(cle)).toEqual(['b', 'c', 'a']);
  });

  it('conserve l’ordre quand une seule liste est fournie', () => {
    const seule = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(fusionnerRangs([seule], cle).map(cle)).toEqual(['x', 'y', 'z']);
  });

  it('ne rend rien pour deux listes vides', () => {
    expect(fusionnerRangs<{ id: string }>([[], []], cle)).toEqual([]);
  });
});
