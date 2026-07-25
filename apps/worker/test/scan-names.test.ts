import { describe, expect, it } from 'vitest';
import { cleNom, clePage, creerIndex, indexer, resoudre } from '../src/jobs/scan-names.js';

describe('cleNom', () => {
  it('ignore extension, séparateurs et casse', () => {
    expect(cleNom('Livre_2_Page445.PNG')).toBe(cleNom('livre 2 page445.png'));
  });
  it('normalise l’arabe décomposé (NFD) vers NFC', () => {
    const nfc = 'فتاوى_2_Page1.png';
    expect(cleNom(nfc.normalize('NFD'))).toBe(cleNom(nfc));
  });
});

describe('clePage', () => {
  it('extrait le numéro de page final', () => {
    expect(clePage('recueil_Page445.png')).toBe('page445');
    expect(clePage('recueil Page 007.png')).toBe('page7');
  });
  it('retourne null sans numéro de page final', () => {
    expect(clePage('couverture.png')).toBeNull();
    expect(clePage('Page445_bis_x.png')).toBeNull();
  });
});

describe('resoudre', () => {
  it('trouve par nom exact', () => {
    const index = creerIndex();
    indexer(index, 'فتاوى اللجنة 2', 'فتاوى_اللجنة_2_Page445.png', 'legacy/l2/فتاوى_اللجنة_2_Page445.png');
    expect(resoudre(index, 'فتاوى_اللجنة_2_Page445.png')).toBe(
      'legacy/l2/فتاوى_اللجنة_2_Page445.png',
    );
  });

  it('trouve malgré une différence de séparateurs ou de casse', () => {
    const index = creerIndex();
    indexer(index, 'Recueil 2', 'Recueil_2_Page445.png', 'legacy/r2/Recueil_2_Page445.png');
    expect(resoudre(index, 'recueil 2 page445.PNG')).toBe('legacy/r2/Recueil_2_Page445.png');
  });

  it('trouve par livre + numéro de page quand le nom diffère', () => {
    const index = creerIndex();
    indexer(index, 'Recueil2', 'Page445.png', 'legacy/Recueil2/Page445.png');
    // image_source contient le nom du livre et la page, le fichier seulement la page
    expect(resoudre(index, 'Recueil2_Page445.png')).toBe('legacy/Recueil2/Page445.png');
  });

  it('ne rapproche pas un autre livre ni une autre page', () => {
    const index = creerIndex();
    indexer(index, 'RecueilA', 'Page445.png', 'legacy/RecueilA/Page445.png');
    expect(resoudre(index, 'RecueilB_Page445.png')).toBeUndefined();
    expect(resoudre(index, 'RecueilA_Page446.png')).toBeUndefined();
  });
});
