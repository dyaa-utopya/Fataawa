import { describe, expect, it } from 'vitest';
import { recollerFidele, squelette } from '../src/voyelles.js';

describe('squelette', () => {
  it('retire les signes de vocalisation et le tatweel', () => {
    expect(squelette('الصَّلَاةُ')).toBe('الصلاة');
    expect(squelette('الصـــلاة')).toBe('الصلاة');
    expect(squelette('مُحَمَّدٌ')).toBe('محمد');
  });

  it('ne normalise rien d’autre : une lettre changée reste une différence', () => {
    // contrairement à la recherche, où « أ » et « ا » se valent : ici toute
    // substitution de lettre est une modification du texte, donc un refus
    expect(squelette('أحمد')).not.toBe(squelette('احمد'));
    expect(squelette('صلاة')).not.toBe(squelette('صلاه'));
  });

  it('laisse la ponctuation et les chiffres intacts', () => {
    expect(squelette('(الفتوى رقم ٢٦٧٧):')).toBe('(الفتوى رقم ٢٦٧٧):');
  });
});

describe('recollerFidele', () => {
  it('accepte une vocalisation fidèle', () => {
    const r = recollerFidele('الحمد لله', 'الْحَمْدُ لِلَّهِ');
    expect(r.texte).toBe('الْحَمْدُ لِلَّهِ');
    expect(squelette(r.texte)).toBe('الحمد لله');
    expect(r.vocalises).toBe(2);
    expect(r.refuses).toBe(0);
  });

  it('rend nu tout mot que le modèle a remplacé', () => {
    // « لله » changé en « للرحمن » : le squelette diffère, donc refus
    const r = recollerFidele('الحمد لله', 'الْحَمْدُ لِلرَّحْمَٰنِ');
    expect(squelette(r.texte)).toBe('الحمد لله');
    expect(r.texte).toContain('لله');
    expect(r.refuses).toBe(1);
    expect(r.vocalises).toBe(1);
  });

  it('supprime ce que le modèle a ajouté de son cru', () => {
    // le préambule bavard, cas le plus fréquent
    const r = recollerFidele('الحمد لله', 'إليك النص المشكول: الْحَمْدُ لِلَّهِ');
    expect(squelette(r.texte)).toBe('الحمد لله');
    expect(r.texte).not.toContain('إليك');
    expect(r.refuses).toBe(0);
  });

  it('remet un mot que le modèle a oublié', () => {
    const r = recollerFidele('الحمد لله رب العالمين', 'الْحَمْدُ لِلَّهِ الْعَالَمِينَ');
    expect(squelette(r.texte)).toBe('الحمد لله رب العالمين');
    expect(r.refuses).toBe(1);
  });

  it('garde les retours à la ligne de l’entrée, non ceux de la sortie', () => {
    // le modèle remanie volontiers la mise en page : elle vient de l'entrée
    const entree = 'الحمد\nلله\n\nرب';
    const r = recollerFidele(entree, 'الْحَمْدُ لِلَّهِ رَبِّ');
    expect(r.texte).toBe('الْحَمْدُ\nلِلَّهِ\n\nرَبِّ');
    expect(squelette(r.texte)).toBe(entree);
  });

  it('préserve la ponctuation et les chiffres de l’entrée', () => {
    const entree = '(الفتوى رقم ٢٦٧٧): الحمد لله.';
    const r = recollerFidele(entree, '(الْفَتْوَى رَقْمُ ٢٦٧٧): الْحَمْدُ لِلَّهِ.');
    expect(squelette(r.texte)).toBe(entree);
  });

  it('rend le texte d’origine quand la sortie est vide ou hors sujet', () => {
    for (const sortie of ['', 'Je ne peux pas vous aider.']) {
      const r = recollerFidele('الحمد لله', sortie);
      expect(squelette(r.texte)).toBe('الحمد لله');
      expect(r.vocalises).toBe(0);
      expect(r.refuses).toBe(2);
    }
  });

  it('situe exactement les mots restés nus', () => {
    // « لله » a été altéré par le modèle, l'original nu est rétabli : c'est ce
    // mot-là, et lui seul, que l'écran doit surligner
    const r = recollerFidele('الحمد لله', 'الْحَمْدُ لِلرَّحْمَٰنِ');
    expect(r.nus).toHaveLength(1);
    const [debut, fin] = r.nus[0] ?? [0, 0];
    expect(r.texte.slice(debut, fin)).toBe('لله');
  });

  it('ne signale ni les chiffres ni le texte latin', () => {
    // ils n'ont aucun signe à recevoir ; les surligner noierait ce qu'il faut voir
    const r = recollerFidele('الفتوى ٢٦٧٧ page', 'الْفَتْوَى ٢٦٧٧ page');
    expect(r.nus).toEqual([]);
  });

  it('signale un mot que le modèle a laissé intact, pas seulement les refusés', () => {
    const r = recollerFidele('الحمد لله', 'الْحَمْدُ لله');
    expect(r.refuses).toBe(0);
    expect(r.nus).toHaveLength(1);
    const [debut, fin] = r.nus[0] ?? [0, 0];
    expect(r.texte.slice(debut, fin)).toBe('لله');
  });

  it('tient le décalage : un mot en trop au début ne fait pas tout refuser', () => {
    // c'est ce qu'un appariement par position produirait — tout décalé, tout
    // refusé. L'alignement par sous-suite commune l'évite.
    const entree = 'الحمد لله رب العالمين';
    const r = recollerFidele(entree, 'النص: الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ');
    expect(squelette(r.texte)).toBe(entree);
    expect(r.vocalises).toBe(4);
    expect(r.refuses).toBe(0);
  });
});
