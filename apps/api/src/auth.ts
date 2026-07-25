import { type App, applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '@fataawa/core';

/**
 * Accès réservé : le front exige une connexion Google, et l'API vérifie
 * elle-même le jeton — sans quoi la protection ne serait que cosmétique
 * (l'URL Cloud Run reste publiquement joignable).
 *
 * ALLOWED_EMAILS : liste d'adresses autorisées, séparées par des virgules.
 * Vide = personne n'est autorisé (fermé par défaut, jamais ouvert par erreur).
 */
export interface AuthConfig {
  allowedEmails: Set<string>;
}

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const emails = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  return { allowedEmails: new Set(emails) };
}

let app: App | undefined;

function adminApp(): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  }
  return app;
}

export interface Utilisateur {
  email: string;
  uid: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    utilisateur?: Utilisateur;
  }
}

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const [type, token] = header.split(' ');
  return type?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Middleware : jeton Firebase valide + adresse dans l'allowlist. */
export function requireUser(cfg: AuthConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearer(req);
    if (!token) {
      res.status(401).json({ erreur: 'connexion requise' });
      return;
    }
    try {
      const decoded = await getAuth(adminApp()).verifyIdToken(token);
      const email = (decoded.email ?? '').toLowerCase();
      if (email === '' || decoded.email_verified !== true) {
        res.status(403).json({ erreur: 'adresse e-mail non vérifiée' });
        return;
      }
      if (!cfg.allowedEmails.has(email)) {
        logger.warn({ email }, 'accès refusé : adresse hors allowlist');
        res.status(403).json({ erreur: 'compte non autorisé' });
        return;
      }
      req.utilisateur = { email, uid: decoded.uid };
      next();
    } catch (err) {
      logger.warn({ err }, 'jeton invalide');
      res.status(401).json({ erreur: 'session expirée, reconnectez-vous' });
    }
  };
}
