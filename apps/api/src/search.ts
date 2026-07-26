import { z } from 'zod';
import {
  type ApiConfig,
  CHAMP_EMBEDDING_ACTUEL,
  type FatwaStored,
  cheminScanLegacy,
  estArtefactSansFatwa,
  fatwasCol,
  gcsExists,
  gcsSignedReadUrl,
  geminiEmbedText,
  livreRef,
  logger,
  toFatwa,
} from '@fataawa/core';

export const searchRequestSchema = z.object({
  requete: z.string().trim().min(2).max(500),
  limite: z.number().int().min(1).max(30).default(15),
});

export interface ResultatRecherche {
  id: string;
  numero_fatwa: string;
  sous_question: string;
  sujet: string;
  sous_sujet: string;
  livre_titre: string;
  livre_id: string;
  /** Pages du livre occupées par la fatwa, pour pouvoir feuilleter le scan. */
  pages: number[];
  /** Début du texte, pour l'aperçu dans la liste. */
  extrait: string;
  texte: string;
  question: string;
  reponse: string;
  url_image: string | null;
}

/**
 * Recherche directe dans les fatwas : même index vectoriel que le chat, mais
 * sans génération. On renvoie les fatwas telles qu'elles sont, à charge du
 * lecteur de les lire — c'est plus rapide (un seul appel au modèle, pour
 * l'embedding de la requête) et le texte n'est jamais reformulé.
 */
export async function rechercher(
  cfg: ApiConfig,
  body: unknown,
): Promise<{ resultats: ResultatRecherche[] }> {
  const { requete, limite } = searchRequestSchema.parse(body);

  const vecteur = await geminiEmbedText(
    requete,
    { model: cfg.embeddingModel, dim: cfg.embeddingDim, taskType: 'RETRIEVAL_QUERY' },
    { apiKey: cfg.geminiApiKey },
  );
  // On demande large : les lignes de sommaire et pages vides de l'ancien
  // pipeline sont écartées ensuite, et la liste doit rester pleine malgré tout.
  const snap = await fatwasCol()
    .findNearest(CHAMP_EMBEDDING_ACTUEL, vecteur, {
      limit: Math.min(limite * 2, 60),
      distanceMeasure: 'COSINE',
    })
    .get();

  const titres = new Map<string, string>();
  const resultats: ResultatRecherche[] = [];
  for (const doc of snap.docs) {
    if (resultats.length >= limite) break;
    const data = doc.data() as FatwaStored;
    const f = toFatwa(doc.id, data);
    if (estArtefactSansFatwa(f.texte)) {
      logger.debug({ fatwaId: f.id }, 'résultat écarté : sommaire ou page sans fatwa');
      continue;
    }

    if (f.livreId !== '' && !titres.has(f.livreId)) {
      const l = await livreRef(f.livreId).get();
      titres.set(f.livreId, l.exists ? ((l.data() as { titre?: string }).titre ?? '') : '');
    }

    let url: string | null = null;
    try {
      const chemin = f.pages[0]?.gcsPath ?? data.gcs_path ?? '';
      if (chemin !== '') {
        url = await gcsSignedReadUrl(cfg.gcsBucket, chemin, cfg.signedUrlTtlMinutes);
      } else if (f.imageSource !== '') {
        const legacy = cheminScanLegacy(cfg.legacyImagePrefix, f.imageSource);
        if (await gcsExists(cfg.gcsBucket, legacy)) {
          url = await gcsSignedReadUrl(cfg.gcsBucket, legacy, cfg.signedUrlTtlMinutes);
        }
      }
    } catch (err) {
      logger.warn({ err, fatwaId: f.id }, 'image indisponible pour ce résultat');
    }

    resultats.push({
      id: f.id,
      numero_fatwa: f.numero,
      sous_question: f.sousQuestion,
      sujet: f.sujetPrincipal,
      sous_sujet: f.sousSujet,
      livre_titre: titres.get(f.livreId) ?? '',
      livre_id: f.livreId,
      pages: f.pages.map((p) => p.numero),
      extrait: f.texte.slice(0, 260),
      texte: f.texte,
      question: data.question_arabe ?? '',
      reponse: data.reponse_arabe ?? '',
      url_image: url,
    });
  }
  return { resultats };
}
