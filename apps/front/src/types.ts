export interface AskSource {
  numero_fatwa: string;
  citation_arabe: string;
  livre_titre: string;
  numero_page: number | null;
  url_image: string | null;
}

export interface AskResponse {
  conversationId: string;
  reponse_utilisateur: string;
  suggestions_cliquables: string[];
  sources_utilisees: AskSource[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  texte: string;
  sources?: AskSource[];
  suggestions?: string[];
}
