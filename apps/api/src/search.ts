import { z } from 'zod';
import {
  type ApiConfig,
  CHAMP_EMBEDDING_ACTUEL,
  type FatwaStored,
  cheminScanLegacy,
  estArtefactSansFatwa,
  fatwasCol,
  fusionnerRangs,
  gcsExists,
  gcsSignedReadUrl,
  geminiEmbedText,
  jetonsRequete,
  livreRef,
  logger,
  numeroDemande,
  scoreLexical,
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
  /**
   * Ce qui a fait remonter ce résultat : le numéro exact, les mots, le sens, ou
   * les deux. Sans cette mention, un résultat par mots-clés et un résultat par
   * proximité de sens sont indiscernables à l'écran, et la recherche paraît
   * capricieuse.
   */
  origine: 'numero' | 'mots' | 'sens' | 'mots+sens';
}

/** Candidats interrogés par mot : borne le coût d'un mot très répandu. */
const CANDIDATS_PAR_MOT = 150;

type Trouve = { id: string; data: FatwaStored };

/** Fatwa portant exactement ce numéro. Réponse, non suggestion : elle passe devant. */
async function parNumero(numero: string): Promise<Trouve[]> {
  const snap = await fatwasCol().where('numero_fatwa', '==', numero).limit(10).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as FatwaStored }));
}

/**
 * Candidats par mots-clés.
 *
 * Une requête par mot plutôt qu'un seul `array-contains-any` : chaque mot
 * obtient ainsi son propre quota de candidats. Avec une requête unique, un mot
 * très répandu remplirait la limite à lui seul et les fatwas portant TOUS les
 * mots demandés — précisément celles qu'on cherche — n'y figureraient pas.
 *
 * On ne rapatrie d'abord que le champ `mots`, qui suffit à classer ; les
 * documents entiers ne sont lus qu'une fois le classement fait.
 */
async function parMots(mots: string[]): Promise<Trouve[]> {
  if (mots.length === 0) return [];
  const lots = await Promise.all(
    mots.map((m) =>
      fatwasCol()
        .where('mots', 'array-contains', m)
        .select('mots')
        .limit(CANDIDATS_PAR_MOT)
        .get(),
    ),
  );

  const jetonsParId = new Map<string, string[]>();
  for (const lot of lots) {
    for (const d of lot.docs) {
      jetonsParId.set(d.id, ((d.data() as FatwaStored).mots ?? []) as string[]);
    }
  }
  const classes = [...jetonsParId.entries()]
    .map(([id, jetons]) => ({ id, score: scoreLexical(jetons, mots), taille: jetons.length }))
    // à nombre égal de mots trouvés, la fatwa la plus courte passe devant :
    // la même correspondance y pèse plus lourd
    .sort((a, b) => b.score - a.score || a.taille - b.taille)
    .slice(0, 60);

  const docs = await Promise.all(classes.map((c) => fatwasCol().doc(c.id).get()));
  return docs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, data: d.data() as FatwaStored }));
}

/**
 * Recherche directe dans les fatwas : sans génération, et sur deux chemins.
 *
 * Le chemin sémantique trouve le sens — c'est lui qui répond quand le lecteur
 * décrit son problème avec ses propres mots. Le chemin lexical trouve le mot
 * exact et le numéro — ce que les vecteurs ne savent pas faire, le sens d'un
 * numéro n'existant pas. Les deux listes sont fusionnées par rangs réciproques,
 * sans comparer des scores incommensurables.
 *
 * Le questions/réponses, lui, reste sémantique seul : une question formulée
 * librement ne rencontre presque jamais les mots du livre.
 */
export async function rechercher(
  cfg: ApiConfig,
  body: unknown,
): Promise<{ resultats: ResultatRecherche[] }> {
  const { requete, limite } = searchRequestSchema.parse(body);
  const mots = jetonsRequete(requete);
  const numero = numeroDemande(requete);

  // Un numéro demandé seul n'a pas de sens à chercher : on économise l'appel
  // d'embedding, qui ne rendrait que des voisins thématiques sans rapport.
  const vecteur =
    numero !== ''
      ? null
      : await geminiEmbedText(
          requete,
          { model: cfg.embeddingModel, dim: cfg.embeddingDim, taskType: 'RETRIEVAL_QUERY' },
          { apiKey: cfg.geminiApiKey },
        );

  const [exacts, lexicaux, semantiques] = await Promise.all([
    numero === '' ? Promise.resolve([]) : parNumero(numero),
    parMots(mots),
    vecteur === null
      ? Promise.resolve([])
      : // On demande large : les lignes de sommaire et pages vides de l'ancien
        // pipeline sont écartées ensuite, et la liste doit rester pleine malgré tout.
        fatwasCol()
          .findNearest(CHAMP_EMBEDDING_ACTUEL, vecteur, {
            limit: Math.min(limite * 2, 60),
            distanceMeasure: 'COSINE',
          })
          .get()
          .then((s) => s.docs.map((d) => ({ id: d.id, data: d.data() as FatwaStored }))),
  ]);

  const idsLexicaux = new Set(lexicaux.map((t) => t.id));
  const idsSemantiques = new Set(semantiques.map((t) => t.id));
  const idsExacts = new Set(exacts.map((t) => t.id));
  const origine = (id: string): ResultatRecherche['origine'] => {
    if (idsExacts.has(id)) return 'numero';
    const l = idsLexicaux.has(id);
    const s = idsSemantiques.has(id);
    return l && s ? 'mots+sens' : l ? 'mots' : 'sens';
  };

  // le numéro exact devant, puis la fusion des deux chemins
  const fusionnes = fusionnerRangs<Trouve>([lexicaux, semantiques], (t) => t.id).filter(
    (t) => !idsExacts.has(t.id),
  );
  const candidats = [...exacts, ...fusionnes];

  logger.info(
    {
      requete: requete.slice(0, 80),
      mots,
      numero,
      exacts: exacts.length,
      lexicaux: lexicaux.length,
      semantiques: semantiques.length,
    },
    'recherche : deux chemins fusionnés',
  );

  const titres = new Map<string, string>();
  const resultats: ResultatRecherche[] = [];
  for (const { id, data } of candidats) {
    if (resultats.length >= limite) break;
    const f = toFatwa(id, data);
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
      origine: origine(f.id),
    });
  }
  return { resultats };
}
