import express, { Router } from 'express';
import { ZodError } from 'zod';
import {
  type PageDoc,
  apiConfig,
  gcsSignedReadUrl,
  logger,
  pageRef,
} from '@fataawa/core';
import { adminRouter } from './admin.js';
import { VectorIndexError, handleAsk } from './ask.js';
import { parseAppCheckConfig, parseAuthConfig, requireAppCheck } from './auth.js';
import { TokenBucketLimiter } from './ratelimit.js';
import { rechercher } from './search.js';
import { vocaliser } from './voyelles.js';
import { asyncHandler } from './util.js';

/**
 * API publique — déployée sur le service Cloud Run existant `chercherf`.
 * Servie derrière Firebase Hosting (rewrite /api/** → ce service), d'où le
 * double montage /v1 et /api/v1. Front public sans login : rate limiting par
 * IP + max-instances bas côté Cloud Run.
 */
const cfg = apiConfig();
// La consultation est publique ; seul l'espace d'ajout de fatwas exige un
// compte autorisé (allowlist vérifiée côté serveur à chaque requête).
const auth = parseAuthConfig(process.env);
const appCheck = parseAppCheckConfig(process.env);
const attestation = requireAppCheck(appCheck);
if (auth.allowedEmails.size === 0) {
  logger.warn('ALLOWED_EMAILS vide : l’espace d’ajout de fatwas est fermé à tous');
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

/**
 * Deux limiteurs, parce que les deux usages ne coûtent pas la même chose : une
 * question déclenche un triage, une génération et un embedding, une recherche
 * un seul embedding. Les mesurer ensemble laisserait la recherche payer pour le
 * chat, ou l'inverse.
 *
 * La clé est l'IP, faute de compte : cela arrête un script emballé et l'abus
 * ordinaire, pas quelqu'un qui change d'adresse. Le vrai plafond de dépense
 * reste max-instances côté Cloud Run et le quota Gemini.
 */
function parIp(limiter: TokenBucketLimiter): express.RequestHandler {
  return (req, res, next) => {
    if (!limiter.allow(req.ip ?? 'inconnu')) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ erreur: 'trop de requêtes, réessayez dans une minute' });
      return;
    }
    next();
  };
}
// rafale à la moitié du débit : une salve de questions simultanées passe, un
// martèlement continu non
const limiterAsk = parIp(new TokenBucketLimiter(cfg.askRateLimitRpm, Math.ceil(cfg.askRateLimitRpm / 2)));
const limiterMw = parIp(new TokenBucketLimiter(cfg.rateLimitRpm));
// Le vocaliseur coûte davantage qu'une recherche : jusqu'à trois pages de
// texte à produire, donc une génération longue. Son propre compteur, pour
// qu'un usage intensif du vocaliseur ne ferme pas la recherche, ni l'inverse.
const limiterVoyelles = parIp(
  new TokenBucketLimiter(cfg.vocalisationRateLimitRpm, Math.ceil(cfg.vocalisationRateLimitRpm / 2)),
);

const v1 = Router();

v1.post(
  '/ask',
  limiterAsk,
  attestation,
  asyncHandler(async (req, res) => {
    const result = await handleAsk(cfg, req.body);
    res.status(200).json(result);
  }),
);

// URL signée fraîche pour une page scannée (les url_image expirent au bout d'1 h)
// Pas d'attestation ici : cette route est appelée par une balise <img>, qui ne
// sait pas porter d'en-tête. Elle ne rend qu'une redirection vers une URL signée
// à durée de vie courte, et reste soumise au débit par IP.
v1.get(
  '/images/:livreId/:pageId',
  limiterMw,
  asyncHandler(async (req, res) => {
    const { livreId, pageId } = req.params as { livreId: string; pageId: string };
    const snap = await pageRef(livreId, pageId).get();
    if (!snap.exists) {
      res.status(404).json({ erreur: 'page inconnue' });
      return;
    }
    const page = snap.data() as PageDoc;
    const url = await gcsSignedReadUrl(cfg.gcsBucket, page.gcsPath, cfg.signedUrlTtlMinutes);
    res.redirect(302, url);
  }),
);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'fataawa-api' });
});
app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'fataawa-api',
    routes: ['/v1/ask', '/v1/search', '/v1/voyelles', '/v1/images/:livreId/:pageId'],
  });
});

// Recherche directe : les fatwas telles quelles, sans réponse générée.
v1.post(
  '/search',
  limiterMw,
  attestation,
  asyncHandler(async (req, res) => {
    res.status(200).json(await rechercher(cfg, req.body));
  }),
);

// Vocalisation — produit distinct : ni corpus, ni mémoire, ni recherche. Le
// texte soumis n'est jamais enregistré, et les journaux n'en gardent que des
// compteurs.
v1.post(
  '/voyelles',
  limiterVoyelles,
  attestation,
  asyncHandler(async (req, res) => {
    res.status(200).json(await vocaliser(cfg, req.body));
  }),
);

v1.use('/admin', adminRouter(cfg, auth));

app.use('/v1', v1);
app.use('/api/v1', v1);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ erreur: 'requête invalide', details: err.issues });
    return;
  }
  if (err instanceof VectorIndexError) {
    logger.error({ err }, 'index vectoriel indisponible');
    res.status(503).json({ erreur: 'index de recherche en cours de préparation, réessayez' });
    return;
  }
  logger.error({ err }, 'erreur non gérée');
  res.status(500).json({ erreur: 'interne' });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  logger.info(
    { port, modele: cfg.geminiModel, topK: cfg.topK, appCheck: appCheck.enforce ? 'application' : 'observation' },
    'fataawa-api démarré',
  );
});
