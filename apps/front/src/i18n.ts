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
  clarifyYes: string;
  clarifyOr: string;
  close: string;
  openFull: string;
  noImage: string;
  signIn: string;
  signInHint: string;
  signOut: string;
  notAllowed: string;
  sessionExpired: string;
  loading: string;
  addFatwas: string;
  uploadTitle: string;
  backToChat: string;
  bookName: string;
  bookPlaceholder: string;
  fileNameHint: string;
  uploadStart: string;
  uploading: string;
  uploadDone: string;
  booksInProgress: string;
  filesSelected: string;
  checking: string;
  pagesDetected: string;
  alreadyPresent: string;
  duplicateWarning: string;
  rejectedFiles: string;
  missingPages: string;
  fixDuplicates: string;
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
    clarifyYes: 'Oui, c’est ma question',
    clarifyOr: 'ou choisissez une autre lecture — ou reformulez librement :',
    close: 'Fermer',
    openFull: 'Ouvrir en taille réelle',
    noImage: 'Page scannée non disponible',
    signIn: 'Se connecter avec Google',
    signInHint: 'Accès réservé. Connectez-vous avec le compte autorisé.',
    signOut: 'Déconnexion',
    notAllowed: 'Ce compte n’est pas autorisé à accéder à Fataawa.',
    sessionExpired: 'Session expirée, reconnectez-vous.',
    loading: 'Chargement…',
    addFatwas: 'Ajouter des fatwas',
    uploadTitle: 'Ajout de fatwas',
    backToChat: 'Retour à la recherche',
    bookName: 'Livre (recueil)',
    bookPlaceholder: 'Nom du recueil, existant ou nouveau',
    fileNameHint: 'Le nom de chaque image doit contenir son numéro de page (ex. page_012.png).',
    uploadStart: 'Envoyer les pages',
    uploading: 'Envoi en cours…',
    uploadDone: 'Pages envoyées. Le traitement (OCR, structuration, indexation) a démarré ; les nouvelles fatwas apparaîtront dans la recherche au fur et à mesure.',
    booksInProgress: 'Livres et avancement',
    filesSelected: 'images sélectionnées',
    checking: 'Vérification des noms de fichiers…',
    pagesDetected: 'Pages détectées :',
    alreadyPresent: 'déjà en base',
    duplicateWarning: 'Numéros de page en doublon :',
    rejectedFiles: 'fichier(s) écarté(s)',
    missingPages: 'Numéros absents de la série :',
    fixDuplicates:
      'Corrigez les noms de fichiers avant d’envoyer : plusieurs images portent le même numéro de page.',
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
    clarifyYes: 'Yes, that’s my question',
    clarifyOr: 'or pick another reading — or simply rephrase:',
    close: 'Close',
    openFull: 'Open full size',
    noImage: 'Scanned page unavailable',
    signIn: 'Sign in with Google',
    signInHint: 'Restricted access. Sign in with the authorised account.',
    signOut: 'Sign out',
    notAllowed: 'This account is not allowed to access Fataawa.',
    sessionExpired: 'Session expired, please sign in again.',
    loading: 'Loading…',
    addFatwas: 'Add fatwas',
    uploadTitle: 'Add fatwas',
    backToChat: 'Back to search',
    bookName: 'Book (collection)',
    bookPlaceholder: 'Collection name, existing or new',
    fileNameHint: 'Each image file name must contain its page number (e.g. page_012.png).',
    uploadStart: 'Upload pages',
    uploading: 'Uploading…',
    uploadDone: 'Pages uploaded. Processing (OCR, structuring, indexing) has started; new fatwas will appear in search progressively.',
    booksInProgress: 'Books and progress',
    filesSelected: 'images selected',
    checking: 'Checking file names…',
    pagesDetected: 'Detected pages:',
    alreadyPresent: 'already stored',
    duplicateWarning: 'Duplicate page numbers:',
    rejectedFiles: 'file(s) skipped',
    missingPages: 'Numbers missing from the range:',
    fixDuplicates: 'Fix the file names before uploading: several images share the same page number.',
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
    clarifyYes: 'نعم، هذا سؤالي',
    clarifyOr: 'أو اختر قراءة أخرى — أو أعد صياغة سؤالك:',
    close: 'إغلاق',
    openFull: 'عرض بالحجم الكامل',
    noImage: 'الصفحة الممسوحة غير متوفرة',
    signIn: 'تسجيل الدخول بحساب Google',
    signInHint: 'الدخول مقيّد. سجّل الدخول بالحساب المصرّح له.',
    signOut: 'تسجيل الخروج',
    notAllowed: 'هذا الحساب غير مصرّح له بالدخول إلى فتاوى.',
    sessionExpired: 'انتهت الجلسة، أعد تسجيل الدخول.',
    loading: 'جارٍ التحميل…',
    addFatwas: 'إضافة فتاوى',
    uploadTitle: 'إضافة فتاوى',
    backToChat: 'رجوع إلى البحث',
    bookName: 'الكتاب (المجموعة)',
    bookPlaceholder: 'اسم المجموعة، موجودة أو جديدة',
    fileNameHint: 'يجب أن يحتوي اسم كل صورة على رقم الصفحة (مثال: page_012.png).',
    uploadStart: 'إرسال الصفحات',
    uploading: 'جارٍ الإرسال…',
    uploadDone: 'تم إرسال الصفحات. بدأت المعالجة (المسح الضوئي، التنظيم، الفهرسة)؛ ستظهر الفتاوى الجديدة في البحث تدريجياً.',
    booksInProgress: 'الكتب والتقدّم',
    filesSelected: 'صورة محدّدة',
    checking: 'جارٍ التحقّق من أسماء الملفات…',
    pagesDetected: 'الصفحات المكتشفة:',
    alreadyPresent: 'موجودة مسبقاً',
    duplicateWarning: 'أرقام صفحات مكرّرة:',
    rejectedFiles: 'ملف/ملفات مستبعدة',
    missingPages: 'أرقام ناقصة في التسلسل:',
    fixDuplicates: 'صحّح أسماء الملفات قبل الإرسال: عدة صور تحمل رقم الصفحة نفسه.',
    errorNetwork: 'خطأ في الاتصال، أعد المحاولة.',
    rateLimited: 'طلبات كثيرة، انتظر دقيقة.',
    disclaimer: 'مساعد وثائقي: ينقل مضمون الفتاوى المذكورة ولا يغني عن سؤال أهل العلم.',
  },
};
