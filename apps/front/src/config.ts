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
