/**
 * Chemin de l'espace d'administration.
 *
 * L'adresse n'est pas publiée : rien ne renvoie vers elle depuis le site, et
 * il faut la connaître pour l'atteindre. Ce n'est pas ce qui protège l'espace
 * — le code du site est public, donc ce chemin l'est aussi pour qui le lit. La
 * protection reste la connexion Google et l'allowlist vérifiée à chaque
 * requête par le serveur : sans compte autorisé, l'adresse ne donne rien.
 *
 * Modifiable au build (VITE_ADMIN_PATH) sans toucher au code.
 */
export const CHEMIN_ADMIN = `/${import.meta.env.VITE_ADMIN_PATH ?? 'a7f3c9e2b14d86'}`;

export function estCheminAdmin(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === CHEMIN_ADMIN;
}

/**
 * Longueur maximale du texte soumis au vocaliseur — trois pages.
 *
 * Mesuré sur les 1 439 pages de vrai texte du corpus : 1 014 caractères en
 * médiane, 1 187 au 90ᵉ centile. Le serveur applique la même borne ; celle-ci
 * n'est là que pour l'annoncer avant l'envoi.
 */
export const LIMITE_VOCALISATION = 4000;

/** Pages téléversées d'un coup. Au-delà, le texte extrait dépasserait la borne. */
export const PAGES_MAX = 3;
