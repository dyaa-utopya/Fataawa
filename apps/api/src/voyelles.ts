import { z } from 'zod';
import {
  type ApiConfig,
  LIMITE_VOCALISATION,
  OCR_VOCALISATION_PROMPT,
  TYPES_PAGE,
  VOCALISATION_SYSTEM,
  geminiGenerateText,
  logger,
  recollerFidele,
  squelette,
} from '@fataawa/core';

/**
 * Vocaliseur — service à part entière.
 *
 * Ne touche ni au corpus, ni à la recherche, ni aux conversations : un texte
 * entre, le même texte voyellé sort. Rien n'est conservé, aucune trace du texte
 * soumis n'est écrite — ni en base, ni dans les journaux, où l'on ne consigne
 * que des compteurs.
 */
export const vocalisationRequestSchema = z.object({
  texte: z.string().trim().min(2).max(LIMITE_VOCALISATION),
});

export interface ReponseVocalisation {
  texte: string;
  /** Mots auxquels des signes ont été ajoutés. */
  vocalises: number;
  /** Mots rendus nus faute d'une restitution fidèle du modèle. */
  refuses: number;
  mots: number;
}

/** Compte les mots comme le recollage les compte, marques comprises. */
function compterMots(texte: string): number {
  return texte.split(/[^\p{L}\p{N}\p{M}]+/u).filter((m) => m !== '').length;
}

/** Page refusée : type inconnu, ou plus de texte que le vocaliseur n'en prend. */
export class PageRefusee extends Error {
  constructor(
    readonly statut: number,
    readonly motif: 'type' | 'trop_long' | 'vide',
  ) {
    super(motif);
  }
}

/**
 * Lit une page téléversée et rend son texte, sans voyelles.
 *
 * Étape séparée de la vocalisation, et c'est délibéré : l'OCR se trompe parfois,
 * et le texte extrait revient dans le champ de saisie où il peut être corrigé
 * avant d'être vocalisé. Vocaliser directement enfermerait l'erreur.
 *
 * Le fichier n'est jamais écrit : il traverse la mémoire, part au modèle, et
 * disparaît avec la requête.
 */
export async function lirePage(
  cfg: ApiConfig,
  octets: Buffer,
  typeMime: string,
): Promise<{ texte: string }> {
  const type = typeMime.split(';')[0]?.trim() ?? '';
  if (!TYPES_PAGE.has(type)) throw new PageRefusee(415, 'type');

  const brut = await geminiGenerateText(
    {
      model: cfg.vocalisationModel,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: type, data: octets.toString('base64') } },
            { text: OCR_VOCALISATION_PROMPT },
          ],
        },
      ],
    },
    { apiKey: cfg.geminiApiKey },
  );

  const texte = brut.trim();
  if (texte === '') throw new PageRefusee(422, 'vide');
  // Le nombre de pages d'un PDF ne se compte pas sans outil ; la borne qui
  // compte est de toute façon celle du vocaliseur, exprimée en caractères.
  if (texte.length > LIMITE_VOCALISATION) throw new PageRefusee(413, 'trop_long');

  logger.info(
    { type, octets: octets.length, caracteres: texte.length, modele: cfg.vocalisationModel },
    'page lue pour vocalisation',
  );
  return { texte };
}

export async function vocaliser(cfg: ApiConfig, body: unknown): Promise<ReponseVocalisation> {
  const { texte } = vocalisationRequestSchema.parse(body);

  const brut = await geminiGenerateText(
    {
      model: cfg.vocalisationModel,
      systemInstruction: VOCALISATION_SYSTEM,
      contents: [{ role: 'user', parts: [{ text: texte }] }],
    },
    { apiKey: cfg.geminiApiKey },
  );

  // Le recollage n'est pas une précaution : mesuré sur dix textes du corpus, 6
  // à 8 sorties sur 10 modifiaient le texte — une lettre ajoutée pour
  // « corriger » une forme verbale, un mot passé. Le squelette rendu est celui
  // reçu, sans quoi ce service falsifierait ce qu'on lui confie.
  const recolle = recollerFidele(texte, brut);
  const fidele = squelette(recolle.texte) === squelette(texte);
  if (!fidele) {
    // Ne devrait pas arriver : le recollage le garantit par construction. Si
    // cela se produit, on rend le texte d'origine plutôt qu'un texte altéré.
    logger.error({ mots: compterMots(texte) }, 'vocalisation : squelette non préservé, texte rendu nu');
    return { texte, vocalises: 0, refuses: compterMots(texte), mots: compterMots(texte) };
  }

  const mots = compterMots(texte);
  logger.info(
    {
      mots,
      vocalises: recolle.vocalises,
      refuses: recolle.refuses,
      bruteFidele: squelette(brut) === squelette(texte),
      modele: cfg.vocalisationModel,
    },
    'vocalisation rendue',
  );
  return { texte: recolle.texte, vocalises: recolle.vocalises, refuses: recolle.refuses, mots };
}
