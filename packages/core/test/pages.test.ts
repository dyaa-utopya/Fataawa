import { describe, expect, it } from 'vitest';
import {
  extFromMime,
  extractNumeroPage,
  gcsPathForPage,
  isSupportedImageMime,
  normalizeDigits,
  pageIdFromNumero,
} from '../src/pages.js';

describe('normalizeDigits', () => {
  it('convertit les chiffres arabes orientaux', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });
  it('convertit la variante persane', () => {
    expect(normalizeDigits('۴۵۶')).toBe('456');
  });
  it('laisse le reste intact', () => {
    expect(normalizeDigits('page-١٢.png')).toBe('page-12.png');
  });
});

describe('extractNumeroPage', () => {
  it('prend le dernier groupe de chiffres du nom sans extension', () => {
    expect(extractNumeroPage('page_012.png')).toBe(12);
    expect(extractNumeroPage('livre2_page_15.png')).toBe(15);
    expect(extractNumeroPage('scan 7.PNG')).toBe(7);
  });
  it('gère les chiffres arabes orientaux', () => {
    expect(extractNumeroPage('٠١٢.png')).toBe(12);
  });
  it("ignore les chiffres de l'extension", () => {
    expect(extractNumeroPage('page_3.v2')).toBe(3);
  });
  it('retourne null sans aucun chiffre', () => {
    expect(extractNumeroPage('couverture.png')).toBeNull();
    expect(extractNumeroPage('.png')).toBeNull();
  });
});

describe('pageIdFromNumero', () => {
  it('zéro-padde sur 4 positions', () => {
    expect(pageIdFromNumero(7)).toBe('0007');
    expect(pageIdFromNumero(123)).toBe('0123');
  });
  it('ne tronque pas au-delà de 4 chiffres', () => {
    expect(pageIdFromNumero(12345)).toBe('12345');
  });
});

describe('mime / chemins GCS', () => {
  it('mappe les types image connus', () => {
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(isSupportedImageMime('image/webp')).toBe(true);
    expect(isSupportedImageMime('application/pdf')).toBe(false);
  });
  it('construit le chemin canonique', () => {
    expect(gcsPathForPage('abc123', '0012', 'image/png')).toBe('livres/abc123/pages/0012.png');
  });
});
