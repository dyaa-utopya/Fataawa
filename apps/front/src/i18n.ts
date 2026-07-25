export type Lang = 'fr' | 'en' | 'ar';

export interface Dict {
  appTitle: string;
  tagline: string;
  emptyTitle: string;
  emptyBody: string;
  inputPlaceholder: string;
  send: string;
  thinking: string;
  newChat: string;
  sources: string;
  suggestions: string;
  viewPage: string;
  page: string;
  fatwa: string;
  errorNetwork: string;
  rateLimited: string;
  disclaimer: string;
}

export const DICT: Record<Lang, Dict> = {
  fr: {
    appTitle: 'Fataawa',
    tagline: 'Recherche dans les recueils de fatwas numérisés',
    emptyTitle: 'Posez votre question',
    emptyBody:
      'Les réponses sont construites uniquement à partir des fatwas des recueils numérisés, avec leurs sources.',
    inputPlaceholder: 'Votre question…',
    send: 'Envoyer',
    thinking: 'Recherche dans les sources…',
    newChat: 'Nouvelle conversation',
    sources: 'Sources',
    suggestions: 'Questions suggérées',
    viewPage: 'Voir la page scannée',
    page: 'page',
    fatwa: 'Fatwa',
    errorNetwork: 'Erreur de connexion, réessayez.',
    rateLimited: 'Trop de requêtes, patientez une minute.',
    disclaimer:
      'Assistant documentaire : il rapporte le contenu des fatwas citées et ne remplace pas l’avis d’un savant.',
  },
  en: {
    appTitle: 'Fataawa',
    tagline: 'Search the digitised fatwa collections',
    emptyTitle: 'Ask your question',
    emptyBody:
      'Answers are built exclusively from the fatwas of the digitised collections, with their sources.',
    inputPlaceholder: 'Your question…',
    send: 'Send',
    thinking: 'Searching the sources…',
    newChat: 'New conversation',
    sources: 'Sources',
    suggestions: 'Suggested questions',
    viewPage: 'View scanned page',
    page: 'page',
    fatwa: 'Fatwa',
    errorNetwork: 'Connection error, please retry.',
    rateLimited: 'Too many requests, wait a minute.',
    disclaimer:
      'Documentary assistant: it reports the content of the cited fatwas and does not replace a scholar’s advice.',
  },
  ar: {
    appTitle: 'فتاوى',
    tagline: 'البحث في مجموعات الفتاوى الرقمية',
    emptyTitle: 'اطرح سؤالك',
    emptyBody: 'تُبنى الإجابات حصراً من فتاوى الكتب الرقمية، مع مصادرها.',
    inputPlaceholder: 'سؤالك…',
    send: 'إرسال',
    thinking: 'جارٍ البحث في المصادر…',
    newChat: 'محادثة جديدة',
    sources: 'المصادر',
    suggestions: 'أسئلة مقترحة',
    viewPage: 'عرض الصفحة الممسوحة',
    page: 'صفحة',
    fatwa: 'فتوى',
    errorNetwork: 'خطأ في الاتصال، أعد المحاولة.',
    rateLimited: 'طلبات كثيرة، انتظر دقيقة.',
    disclaimer: 'مساعد وثائقي: ينقل مضمون الفتاوى المذكورة ولا يغني عن سؤال أهل العلم.',
  },
};
