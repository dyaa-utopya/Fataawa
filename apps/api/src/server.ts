import express from 'express';
import { logger } from '@fataawa/core';

/**
 * Squelette de l'API publique (future évolution du service Cloud Run
 * `chercherf`). Phase 3 : /v1/ask conversationnel (vector search Firestore +
 * génération Gemini + URLs signées GCS) et routes legacy du front GAS.
 * NE PAS déployer sur `chercherf` avant la phase 3 : le service actuel en
 * production serait remplacé.
 */
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'fataawa-api' });
});

app.get('/', (_req, res) => {
  res.status(200).json({ service: 'fataawa-api', etat: 'squelette — bascule prévue en phase 3' });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  logger.info({ port }, 'fataawa-api démarré (squelette)');
});
