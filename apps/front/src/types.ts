export interface AskSource {
  numero_fatwa: string;
  citation_arabe: string;
  livre_titre: string;
  numero_page: number | null;
  url_image: string | null;
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
