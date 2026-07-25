import express from 'express';
import { logger, workerConfig } from '@fataawa/core';
import { ingestionRouter } from './routes/ingestion.js';
import { ocrRouter } from './routes/ocr.js';
import { relanceRouter } from './routes/relance.js';

// Fail fast : la configuration est validée au démarrage.
const cfg = workerConfig();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'fataawa-worker' });
});

// L'authentification est portée par Cloud Run (IAM, --no-allow-unauthenticated) :
// seuls Cloud Tasks et Cloud Scheduler, munis d'un jeton OIDC du service
// account autorisé, peuvent atteindre ces routes.
app.use('/tasks', ingestionRouter(cfg));
app.use('/tasks', ocrRouter(cfg));
app.use('/tasks', relanceRouter(cfg));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'erreur non gérée');
  res.status(500).json({ erreur: 'interne' });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  logger.info({ port, bucket: cfg.gcsBucket, modele: cfg.geminiModel }, 'fataawa-worker démarré');
});
