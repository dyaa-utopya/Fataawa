import { Router } from 'express';
import { z } from 'zod';
import {
  type ApiConfig,
  type LivreDoc,
  enqueueWorkerTask,
  extractNumeroPage,
  gcsSignedUploadUrl,
  isSupportedImageMime,
  livresCol,
  logger,
  pagesCol,
  sanitizeIdPart,
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

/** Vérification d'un livre complet avant le premier octet envoyé. */
const verificationSchema = z.object({
  livre: z.string().trim().min(1).max(200),
  fichiers: z.array(fichierSchema).min(1).max(2000),
});

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

  return router;
}
