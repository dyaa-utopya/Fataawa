import { type FirebaseApp, initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, getToken, initializeAppCheck } from 'firebase/app-check';

/**
 * Configuration web Firebase : publique par nature (elle identifie le projet,
 * elle n'autorise rien par elle-même). L'accès réel est verrouillé par les
 * domaines autorisés côté Firebase Auth et par l'allowlist d'adresses
 * vérifiée par l'API à chaque requête.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyBTckAyYjcJ0FDLg3AeC0dJnrIcQrGCX5Y',
  authDomain: 'looker-studio-458310.firebaseapp.com',
  projectId: 'looker-studio-458310',
  appId: '1:1043287255633:web:881d8cda8fa5e3da8aa670',
};

export const app: FirebaseApp = initializeApp(firebaseConfig);

/**
 * App Check : atteste que l'appel vient bien de ce site, et pas d'un script qui
 * taperait sur l'API depuis ailleurs. C'est la seule protection qui change la
 * nature du problème sur un front sans login — un compteur par IP se contourne
 * en changeant d'adresse.
 *
 * La clé du site est publique, comme la configuration ci-dessus : elle ne vaut
 * que couplée au domaine déclaré (fataawa.web.app) et au score reCAPTCHA, tous
 * deux vérifiés côté Google. reCAPTCHA tourne en mode « score » : aucune case à
 * cocher, rien à faire pour le lecteur.
 */
const SITE_KEY = '6LcP2WUtAAAAADV8FfaB5YIHJ789Q5N5bmAWKYED';

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

/**
 * Jeton d'attestation à joindre aux appels API. Ne fait jamais échouer la
 * requête : si l'attestation échoue (réseau, extension qui bloque reCAPTCHA),
 * l'appel part sans jeton et c'est le serveur qui décide s'il l'accepte. Rendre
 * le site inutilisable parce que reCAPTCHA n'a pas répondu serait pire que le
 * risque qu'App Check couvre.
 */
export async function jetonAppCheck(): Promise<string | null> {
  try {
    return (await getToken(appCheck, false)).token;
  } catch {
    return null;
  }
}
