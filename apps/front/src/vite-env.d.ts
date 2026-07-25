/// <reference types="vite/client" />

/** Variables de build lues par le front (préfixe VITE_, injectées par Vite). */
interface ImportMetaEnv {
  /** Chemin de l'espace d'administration, sans la barre de tête. */
  readonly VITE_ADMIN_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
