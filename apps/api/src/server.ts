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
import { parseAuthConfig } from './auth.js';
import { TokenBucketLimiter } from './ratelimit.js';
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
if (auth.allowedEmails.size === 0) {
  logger.warn('ALLOWED_EMAILS vide : l’espace d’ajout de fatwas est fermé à tous');
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

const limiter = new TokenBucketLimiter(cfg.rateLimitRpm);
const limiterMw: express.RequestHandler = (req, res, next) => {
  if (!limiter.allow(req.ip ?? 'inconnu')) {
    res.status(429).json({ erreur: 'trop de requêtes, réessayez dans une minute' });
    return;
  }
  next();
};

const v1 = Router();

v1.post(
  '/ask',
  limiterMw,
  asyncHandler(async (req, res) => {
    const result = await handleAsk(cfg, req.body);
    res.status(200).json(result);
  }),
);

// URL signée fraîche pour une page scannée (les url_image expirent au bout d'1 h)
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
  res.status(200).json({ service: 'fataawa-api', routes: ['/v1/ask', '/v1/images/:livreId/:pageId'] });
});

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
  logger.info({ port, modele: cfg.geminiModel, topK: cfg.topK }, 'fataawa-api démarré');
});
