import { Router } from 'express';
import { z } from 'zod';
import {
  type ApiConfig,
  COL_FATWAS,
  type FatwaStored,
  type LivreDoc,
  SECTION_AUTRE,
  TAXONOMIE,
  enqueueWorkerTask,
  db,
  extractNumeroPage,
  gcsSignedUploadUrl,
  isSupportedImageMime,
  livresCol,
  logger,
  pagesCol,
  sanitizeIdPart,
  toFatwa,
} from '@fataawa/core';
import { type AuthConfig, requireUser } from './auth.js';
import { asyncHandler } from './util.js';

/**
 * Un livre entier (500 pages à 1–2 Mo) peut demander une heure d'envoi sur une
 * connexion modeste : les URLs doivent survivre à tout le transfert.
 */
const UPLOAD_TTL_MINUTES = 6 * 60;
const MAX_FICHIERS_PAR_LOT = 200;

const fichierSchema = z.object({
  nom: z.string().trim().min(1).max(300),
  type: z.string().trim().min(1).max(100),
});

const demandeUploadSchema = z.object({
  livre: z.string().trim().min(1).max(200),
  fichiers: z.array(fichierSchema).min(1).max(MAX_FICHIERS_PAR_LOT),
});

const demandePdfSchema = z.object({
  livre: z.string().trim().min(1).max(200),
  nom: z.string().trim().min(1).max(300),
});

const decoupageSchema = z.object({
  livre: z.string().trim().min(1).max(200),
  chemin: z.string().trim().min(1).max(500),
});

/** Vérification d'un livre complet avant le premier octet envoyé. */
const verificationSchema = z.object({
  livre: z.string().trim().min(1).max(200),
  fichiers: z.array(fichierSchema).min(1).max(2000),
});

/**
 * Collections que le rapport accepte d'analyser : celle servie au public, et
 * celle où le pipeline écrit pendant le retraitement. Toute autre valeur est
 * ignorée — le nom vient d'une requête, il ne sert jamais tel quel à ouvrir
 * une collection.
 */
const COLLECTIONS_RAPPORT: string[] = [
  ...new Set([COL_FATWAS, process.env.FATWAS_COLLECTION_PIPELINE ?? 'fatawas_v2']),
];

/** Compte des manques d'un livre, tel que le rapport le rend. */
export interface RapportLivre {
  livreId: string;
  titre: string;
  total: number;
  sansNumero: number;
  sansThemeN1: number;
  sansThemeN2: number;
  sansThemeN3: number;
  sansQuestion: number;
  sansReponse: number;
}

export interface RapportExemple {
  id: string;
  numero_fatwa: string;
  sous_question: string;
  livre_titre: string;
  manques: string[];
  extrait: string;
}

export interface FichierPret {
  nom: string;
  url: string | null;
  chemin: string | null;
  numeroPage: number | null;
  refus: string | null;
}

/**
 * Espace d'ajout de fatwas — réservé aux comptes autorisés.
 *
 * Le navigateur téléverse **directement vers GCS** via des URLs signées : ni
 * la taille des scans ni leur nombre ne transitent par Cloud Run. Les fichiers
 * atterrissent sous `inbox/{livre}/`, exactement là où l'ingestion les attend ;
 * le pipeline habituel (OCR → structuration → embedding) fait le reste.
 */
export function adminRouter(cfg: ApiConfig, auth: AuthConfig): Router {
  const router = Router();
  router.use(requireUser(auth));

  /** Livres connus, pour proposer une destination existante. */
  router.get(
    '/livres',
    asyncHandler(async (_req, res) => {
      const snap = await livresCol().orderBy('titre').limit(200).get();
      res.status(200).json({
        livres: snap.docs.map((d) => {
          const l = d.data() as LivreDoc;
          return {
            id: d.id,
            titre: l.titre ?? d.id,
            nbPages: l.nbPages ?? 0,
            nbPagesOcr: l.nbPagesOcr ?? 0,
            nbFatwas: l.nbFatwas ?? 0,
          };
        }),
      });
    }),
  );

  /**
   * Analyse les noms de fichiers d'un livre entier **avant** tout envoi :
   * numéro de page déduit de chaque nom, formats refusés, et surtout numéros
   * en doublon. Un export PDF → PNG mal nommé (numéro constant, par exemple
   * « page 1 sur 500 ») écraserait sinon toutes les pages sur une seule, sans
   * que rien ne le signale. Aucune écriture, aucune URL générée.
   */
  router.post(
    '/verifier',
    asyncHandler(async (req, res) => {
      const { livre, fichiers } = verificationSchema.parse(req.body);
      const livreId = sanitizeIdPart(livre);

      const analyses = fichiers.map((f) => ({
        nom: f.nom,
        numeroPage: isSupportedImageMime(f.type) ? extractNumeroPage(f.nom) : null,
        refus: !isSupportedImageMime(f.type)
          ? 'format non géré (PNG, JPEG, WebP ou TIFF)'
          : extractNumeroPage(f.nom) === null
            ? 'aucun numéro de page dans le nom'
            : null,
      }));

      const parNumero = new Map<number, string[]>();
      for (const a of analyses) {
        if (a.numeroPage === null) continue;
        parNumero.set(a.numeroPage, [...(parNumero.get(a.numeroPage) ?? []), a.nom]);
      }
      const doublons = [...parNumero.entries()]
        .filter(([, noms]) => noms.length > 1)
        .map(([numeroPage, noms]) => ({ numeroPage, noms }));

      const numeros = [...parNumero.keys()].sort((a, b) => a - b);
      const premier = numeros[0] ?? null;
      const dernier = numeros[numeros.length - 1] ?? null;
      const manquants =
        premier !== null && dernier !== null && dernier - premier < 5000
          ? Array.from({ length: dernier - premier + 1 }, (_, i) => premier + i)
              .filter((n) => !parNumero.has(n))
              .slice(0, 50)
          : [];

      // pages déjà présentes pour ce livre : un renvoi ne crée pas de doublon
      const dejaPresentes = (await pagesCol(livreId).select().get()).size;

      res.status(200).json({
        livreId,
        total: fichiers.length,
        acceptes: analyses.filter((a) => a.refus === null).length,
        refuses: analyses.filter((a) => a.refus !== null),
        doublons,
        plage: premier === null ? null : { premier, dernier },
        manquants,
        dejaPresentes,
      });
    }),
  );

  /**
   * Prépare un lot : une URL d'upload par fichier accepté. Les fichiers dont
   * le nom ne porte pas de numéro de page sont refusés ici plutôt que d'être
   * ignorés silencieusement plus tard par l'ingestion.
   */
  router.post(
    '/upload-url',
    asyncHandler(async (req, res) => {
      const { livre, fichiers } = demandeUploadSchema.parse(req.body);
      const livreId = sanitizeIdPart(livre);
      if (livreId === '') {
        res.status(400).json({ erreur: 'nom de livre invalide' });
        return;
      }

      const prets: FichierPret[] = await Promise.all(
        fichiers.map(async (f): Promise<FichierPret> => {
          if (!isSupportedImageMime(f.type)) {
            return { nom: f.nom, url: null, chemin: null, numeroPage: null, refus: 'format non géré (PNG, JPEG, WebP ou TIFF)' };
          }
          const numeroPage = extractNumeroPage(f.nom);
          if (numeroPage === null) {
            return {
              nom: f.nom,
              url: null,
              chemin: null,
              numeroPage: null,
              refus: 'le nom doit contenir le numéro de page (ex. page_012.png)',
            };
          }
          const chemin = `${cfg.gcsInboxPrefix}${livreId}/${f.nom.normalize('NFC')}`;
          const url = await gcsSignedUploadUrl(cfg.gcsBucket, chemin, f.type, UPLOAD_TTL_MINUTES);
          return { nom: f.nom, url, chemin, numeroPage, refus: null };
        }),
      );

      logger.info(
        { livreId, demandes: fichiers.length, acceptes: prets.filter((p) => p.url).length, par: req.utilisateur?.email },
        'lot d’upload préparé',
      );
      res.status(200).json({ livreId, fichiers: prets });
    }),
  );

  /**
   * Voie PDF : une seule URL d'upload pour le fichier entier. Le PDF est bien
   * plus léger que les images qu'il contient (quelques dizaines de Mo contre
   * plusieurs centaines), et c'est le serveur qui produit ensuite les pages en
   * PNG sans perte — donc sans dégradation de lisibilité pour l'OCR, et sans
   * dépendre du nommage des fichiers.
   */
  router.post(
    '/pdf-url',
    asyncHandler(async (req, res) => {
      const { livre, nom } = demandePdfSchema.parse(req.body);
      const livreId = sanitizeIdPart(livre);
      if (livreId === '') {
        res.status(400).json({ erreur: 'nom de livre invalide' });
        return;
      }
      const chemin = `pdf/${livreId}/${nom.normalize('NFC')}`;
      const url = await gcsSignedUploadUrl(
        cfg.gcsBucket,
        chemin,
        'application/pdf',
        UPLOAD_TTL_MINUTES,
      );
      logger.info({ livreId, chemin, par: req.utilisateur?.email }, 'upload PDF préparé');
      res.status(200).json({ livreId, chemin, url });
    }),
  );

  /** Lance le découpage du PDF déposé (le pipeline enchaîne ensuite seul). */
  router.post(
    '/decouper',
    asyncHandler(async (req, res) => {
      const { livre, chemin } = decoupageSchema.parse(req.body);
      const livreId = sanitizeIdPart(livre);
      if (cfg.workerUrl === '' || cfg.tasksServiceAccountEmail === '') {
        res.status(503).json({ erreur: 'découpage indisponible (worker non configuré)' });
        return;
      }
      await enqueueWorkerTask(
        {
          project: cfg.project,
          region: cfg.region,
          workerUrl: cfg.workerUrl,
          serviceAccountEmail: cfg.tasksServiceAccountEmail,
        },
        cfg.ocrQueue,
        '/tasks/pdf-split',
        { livreId, pdfPath: chemin, depuis: 1 },
      );
      logger.info({ livreId, chemin, par: req.utilisateur?.email }, 'découpage PDF lancé');
      res.status(202).json({ lance: true });
    }),
  );

  /** Déclenche l'ingestion sans attendre le passage planifié. */
  router.post(
    '/ingerer',
    asyncHandler(async (_req, res) => {
      if (cfg.workerUrl === '' || cfg.tasksServiceAccountEmail === '') {
        res.status(503).json({ erreur: 'déclenchement indisponible (worker non configuré)' });
        return;
      }
      await enqueueWorkerTask(
        {
          project: cfg.project,
          region: cfg.region,
          workerUrl: cfg.workerUrl,
          serviceAccountEmail: cfg.tasksServiceAccountEmail,
        },
        cfg.ocrQueue,
        '/tasks/ingestion',
        {},
      );
      logger.info({ par: _req.utilisateur?.email }, 'ingestion déclenchée manuellement');
      res.status(202).json({ lance: true });
    }),
  );

  /** La taxonomie servie telle quelle : le front en fait la référence affichée. */
  router.get('/themes', (_req, res) => {
    res.status(200).json({
      sectionAutre: SECTION_AUTRE,
      chapitres: TAXONOMIE.map((c) => ({ nom: c.nom, sections: c.sections })),
    });
  });

  /**
   * Rapport d'anomalies : ce que le pipeline n'a pas su renseigner.
   *
   * Balaie la collection en entier plutôt que d'interroger par champ manquant —
   * Firestore ne sait pas indexer l'absence, et une requête « champ == '' » ne
   * remonterait pas les documents où il n'existe pas du tout.
   *
   * Deux collections coexistent pendant le retraitement : celle que le site
   * sert, et celle où le pipeline écrit. Le rapport doit pouvoir viser l'une ou
   * l'autre — sinon il ne dirait rien du travail en cours. Le nom demandé est
   * confronté à ces deux valeurs connues, jamais utilisé tel quel.
   */
  router.get(
    '/rapport',
    asyncHandler(async (req, res) => {
      const demandee = String(req.query.collection ?? '');
      const collection = COLLECTIONS_RAPPORT.includes(demandee) ? demandee : COL_FATWAS;
      const titres = new Map<string, string>();
      for (const d of (await livresCol().limit(200).get()).docs) {
        titres.set(d.id, (d.data() as LivreDoc).titre ?? d.id);
      }

      const parLivre = new Map<string, RapportLivre>();
      const exemples: RapportExemple[] = [];
      let total = 0;
      let curseur: string | null = null;
      for (;;) {
        let q = db().collection(collection).orderBy('__name__').limit(500);
        if (curseur !== null) q = q.startAfter(curseur);
        const snap = await q.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          const data = doc.data() as FatwaStored;
          const f = toFatwa(doc.id, data);
          const livreId = f.livreId || '(hors pipeline)';
          const r =
            parLivre.get(livreId) ??
            {
              livreId,
              titre: titres.get(livreId) ?? livreId,
              total: 0,
              sansNumero: 0,
              sansThemeN1: 0,
              sansThemeN2: 0,
              sansThemeN3: 0,
              sansQuestion: 0,
              sansReponse: 0,
            };
          r.total++;
          total++;
          const manques: string[] = [];
          if (f.numero === '') (r.sansNumero++, manques.push('numéro'));
          if (f.sujetPrincipal === '') (r.sansThemeN1++, manques.push('thème 1'));
          if (f.sousSujet === '') (r.sansThemeN2++, manques.push('thème 2'));
          if (f.themeN3 === '') (r.sansThemeN3++, manques.push('thème 3'));
          if ((data.question_arabe ?? '') === '') (r.sansQuestion++, manques.push('question'));
          if ((data.reponse_arabe ?? '') === '') (r.sansReponse++, manques.push('réponse'));
          parLivre.set(livreId, r);
          if (manques.length > 0 && exemples.length < 40) {
            exemples.push({
              id: f.id,
              numero_fatwa: f.numero,
              sous_question: f.sousQuestion,
              livre_titre: r.titre,
              manques,
              extrait: f.texte.slice(0, 160),
            });
          }
        }
        const dernier = snap.docs[snap.docs.length - 1];
        if (!dernier || snap.size < 500) break;
        curseur = dernier.id;
      }

      const livres = [...parLivre.values()].sort((a, b) => a.titre.localeCompare(b.titre));
      res.status(200).json({
        collection,
        collectionsDisponibles: COLLECTIONS_RAPPORT,
        total,
        incompletes: livres.reduce(
          (n, l) => n + Math.max(l.sansThemeN1, l.sansThemeN2, l.sansThemeN3),
          0,
        ),
        livres,
        exemples,
      });
    }),
  );

  return router;
}
