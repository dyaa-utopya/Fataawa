/** Ce qu'il faut pour ouvrir le scan d'une fatwa et le feuilleter. */
export interface ScanRef {
  numero_fatwa: string;
  livre_titre: string;
  livre_id: string;
  /** Pages du livre occupées par la fatwa. */
  pages: number[];
  numero_page?: number | null;
  url_image: string | null;
}

export interface AskSource extends ScanRef {
  citation_arabe: string;
  numero_page: number | null;
}

/** Résultat de la recherche directe : la fatwa telle quelle, sans reformulation. */
export interface ResultatRecherche extends ScanRef {
  id: string;
  sous_question: string;
  sujet: string;
  sous_sujet: string;
  extrait: string;
  texte: string;
  question: string;
  reponse: string;
}

export interface AskAnswerResponse {
  type: 'reponse';
  conversationId: string;
  reponse_utilisateur: string;
  suggestions_cliquables: string[];
  sources_utilisees: AskSource[];
}

/** La question était ambiguë : l'API demande confirmation avant de chercher. */
export interface AskClarificationResponse {
  type: 'clarification';
  conversationId: string;
  message: string;
  question_proposee: string;
  autres_interpretations: string[];
}

export type AskResponse = AskAnswerResponse | AskClarificationResponse;

export interface ChatClarification {
  question_proposee: string;
  autres_interpretations: string[];
}

export interface LivreResume {
  id: string;
  titre: string;
  nbPages: number;
  nbPagesOcr: number;
  nbFatwas: number;
}

export interface Verification {
  livreId: string;
  total: number;
  acceptes: number;
  refuses: Array<{ nom: string; numeroPage: number | null; refus: string | null }>;
  doublons: Array<{ numeroPage: number; noms: string[] }>;
  plage: { premier: number; dernier: number } | null;
  manquants: number[];
  dejaPresentes: number;
}

export interface FichierPret {
  nom: string;
  url: string | null;
  chemin: string | null;
  numeroPage: number | null;
  refus: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  texte: string;
  sources?: AskSource[];
  suggestions?: string[];
  clarification?: ChatClarification;
}

export interface Taxonomie {
  sectionAutre: string;
  chapitres: Array<{ nom: string; sections: string[] }>;
}

export interface RapportLivre {
  livreId: string;
  titre: string;
  total: number;
  sansNumero: number;
  sansThemeN1: number;
  sansThemeN2: number;
  sansThemeN3: number;
  sansQuestion: number;
  sansReponse: number;
}

export interface Rapport {
  collection: string;
  collectionsDisponibles: string[];
  total: number;
  incompletes: number;
  livres: RapportLivre[];
  exemples: Array<{
    id: string;
    numero_fatwa: string;
    sous_question: string;
    livre_titre: string;
    manques: string[];
    extrait: string;
  }>;
}
