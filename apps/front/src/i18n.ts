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
  signInFailed: string;
  /** Pourquoi un résultat de recherche est remonté. */
  origine: { numero: string; mots: string; sens: string; 'mots+sens': string };
  signOut: string;
  notAllowed: string;
  sessionExpired: string;
  loading: string;
  addFatwas: string;
  uploadTitle: string;
  backToChat: string;
  bookName: string;
  bookPlaceholder: string;
  bookNew: string;
  fileNameHint: string;
  uploadStart: string;
  uploading: string;
  uploadDone: string;
  filesSelected: string;
  checking: string;
  pagesDetected: string;
  alreadyPresent: string;
  duplicateWarning: string;
  rejectedFiles: string;
  missingPages: string;
  fixDuplicates: string;
  autoRefresh: string;
  modePdf: string;
  modeImages: string;
  pdfHint: string;
  pdfStart: string;
  pdfDone: string;
  errorNetwork: string;
  rateLimited: string;
  disclaimer: string;
  askTab: string;
  searchTab: string;
  vowelsTab: string;
  /** Vocaliseur — produit distinct, d'où son propre bloc de libellés. */
  vowelsTitle: string;
  vowelsHint: string;
  vowelsPlaceholder: string;
  vowelsChars: string;
  vowelsTooLong: string;
  vowelsUploadHint: string;
  vowelsReading: string;
  vowelsBadType: string;
  vowelsNoText: string;
  vowelsStart: string;
  vowelsWorking: string;
  vowelsDone: string;
  vowelsRefused: string;
  vowelsFaithful: string;
  copy: string;
  copied: string;
  searchTitle: string;
  searchBody: string;
  searchPlaceholder: string;
  searchAction: string;
  searching: string;
  noResults: string;
  resultsCount: string;
  subQuestion: string;
  questionLabel: string;
  answerLabel: string;
  readMore: string;
  readLess: string;
  adminTitle: string;
  themesTab: string;
  themesTitle: string;
  themesHint: string;
  themesChapters: string;
  themesSections: string;
  reportTab: string;
  reportTitle: string;
  reportCollection: string;
  reportRefresh: string;
  reportLoading: string;
  reportBook: string;
  reportNoNumber: string;
  reportNoTheme1: string;
  reportNoTheme2: string;
  reportNoTheme3: string;
  reportNoQuestion: string;
  reportNoAnswer: string;
  reportSamples: string;
  clearedIdle: string;
  clearedFull: string;
  previousPage: string;
  nextPage: string;
  fatwaPages: string;
  spansPages: string;
  aroundPage: string;
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
    signInFailed: 'Connexion refusée. Code renvoyé par Google :',
    origine: { numero: 'numéro exact', mots: 'mots', sens: 'sens', 'mots+sens': 'mots + sens' },
    signOut: 'Déconnexion',
    notAllowed: 'Ce compte n’est pas autorisé à accéder à Fataawa.',
    sessionExpired: 'Session expirée, reconnectez-vous.',
    loading: 'Chargement…',
    addFatwas: 'Ajouter des fatwas',
    uploadTitle: 'Ajout de fatwas',
    backToChat: 'Retour à la recherche',
    bookName: 'Livre (recueil)',
    bookPlaceholder: 'Titre du nouveau recueil',
    bookNew: 'Nouveau livre',
    fileNameHint: 'Le nom de chaque image doit contenir son numéro de page (ex. page_012.png).',
    uploadStart: 'Envoyer les pages',
    uploading: 'Envoi en cours…',
    uploadDone: 'Pages envoyées. Le traitement (OCR, structuration, indexation) a démarré ; les nouvelles fatwas apparaîtront dans la recherche au fur et à mesure.',
    filesSelected: 'images sélectionnées',
    checking: 'Vérification des noms de fichiers…',
    pagesDetected: 'Pages détectées :',
    alreadyPresent: 'déjà en base',
    duplicateWarning: 'Numéros de page en doublon :',
    rejectedFiles: 'fichier(s) écarté(s)',
    missingPages: 'Numéros absents de la série :',
    fixDuplicates:
      'Corrigez les noms de fichiers avant d’envoyer : plusieurs images portent le même numéro de page.',
    autoRefresh: 'actualisé automatiquement',
    modePdf: 'Envoyer le PDF',
    modeImages: 'Envoyer des images',
    pdfHint:
      'Le PDF entier, tel quel : bien plus léger à transférer que les images. Le serveur en extrait les pages en PNG sans perte, la numérotation vient du PDF.',
    pdfStart: 'Envoyer le PDF et lancer le traitement',
    pdfDone:
      'PDF envoyé. Le découpage en pages a démarré, puis l’OCR, la structuration et l’indexation s’enchaînent ; l’avancement s’affiche ci-dessous.',
    errorNetwork: 'Erreur de connexion, réessayez.',
    rateLimited: 'Trop de requêtes, patientez une minute.',
    disclaimer:
      'Assistant documentaire : il rapporte le contenu des fatwas citées et ne remplace pas l’avis d’un savant.',
    askTab: 'Question / réponse',
    searchTab: 'Recherche',
    vowelsTab: 'Voyelles',
    vowelsTitle: 'Vocaliser un texte arabe',
    vowelsHint:
      'Collez jusqu’à trois pages de texte arabe : il vous est rendu voyellé, pour être lu à voix haute sans faute de désinence. Le texte n’est ni modifié ni conservé.',
    vowelsPlaceholder: 'Collez ici le texte arabe à vocaliser…',
    vowelsChars: 'caractères',
    vowelsTooLong: 'Texte trop long : retirez une partie.',
    vowelsUploadHint: 'Photo ou PDF, 3 pages au plus. Le texte lu s’affiche ci-dessous, corrigez-le si besoin avant de vocaliser.',
    vowelsReading: 'Lecture de la page',
    vowelsBadType: 'Format non accepté : image (PNG, JPEG, WEBP, TIFF) ou PDF.',
    vowelsNoText: 'Aucun texte arabe lisible sur cette page.',
    vowelsStart: 'Vocaliser',
    vowelsWorking: 'Vocalisation en cours…',
    vowelsDone: 'mots vocalisés',
    vowelsRefused:
      'mot(s) laissé(s) sans voyelles : le modèle les avait modifiés, l’original a été rétabli.',
    vowelsFaithful: 'Texte restitué à l’identique, aux signes de vocalisation près.',
    copy: 'Copier',
    copied: 'Copié',
    searchTitle: 'Recherche dans les fatwas',
    searchBody:
      'Les fatwas sont rendues telles qu’elles sont écrites, sans réponse rédigée : décrivez le sujet cherché, en français ou en arabe.',
    searchPlaceholder: 'Mot-clé ou sujet…',
    searchAction: 'Rechercher',
    searching: 'Recherche en cours…',
    noResults: 'Aucune fatwa trouvée',
    resultsCount: 'fatwas trouvées',
    subQuestion: 'Question',
    questionLabel: 'Question',
    answerLabel: 'Réponse',
    readMore: 'Lire la fatwa',
    readLess: 'Réduire',
    adminTitle: 'Administration',
    themesTab: 'Thèmes',
    themesTitle: 'Taxonomie appliquée à la structuration',
    themesHint:
      'Trois niveaux obligatoires : le chapitre et la section sont pris dans cette liste fermée, le sujet précis reste libre (deux à cinq mots). Un libellé hors liste est effacé plutôt que rapproché de force, et la fatwa apparaît dans le rapport.',
    themesChapters: 'chapitres',
    themesSections: 'sections',
    reportTab: 'Rapport',
    reportTitle: 'Fatwas incomplètes',
    reportCollection: 'collection',
    reportRefresh: 'Actualiser',
    reportLoading: 'Analyse de la collection…',
    reportBook: 'Livre',
    reportNoNumber: 'sans n°',
    reportNoTheme1: 'sans thème 1',
    reportNoTheme2: 'sans thème 2',
    reportNoTheme3: 'sans thème 3',
    reportNoQuestion: 'sans question',
    reportNoAnswer: 'sans réponse',
    reportSamples: 'Exemples',
    clearedIdle: 'Conversation effacée après 3 minutes sans activité.',
    clearedFull: 'Nouvelle conversation : la précédente atteignait 10 messages.',
    previousPage: 'Page précédente',
    nextPage: 'Page suivante',
    fatwaPages: 'page',
    spansPages: 'Cette fatwa occupe les pages',
    aroundPage: 'page voisine',
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
    signInFailed: 'Sign-in refused. Code returned by Google:',
    origine: { numero: 'exact number', mots: 'keywords', sens: 'meaning', 'mots+sens': 'keywords + meaning' },
    signOut: 'Sign out',
    notAllowed: 'This account is not allowed to access Fataawa.',
    sessionExpired: 'Session expired, please sign in again.',
    loading: 'Loading…',
    addFatwas: 'Add fatwas',
    uploadTitle: 'Add fatwas',
    backToChat: 'Back to search',
    bookName: 'Book (collection)',
    bookPlaceholder: 'Title of the new collection',
    bookNew: 'New book',
    fileNameHint: 'Each image file name must contain its page number (e.g. page_012.png).',
    uploadStart: 'Upload pages',
    uploading: 'Uploading…',
    uploadDone: 'Pages uploaded. Processing (OCR, structuring, indexing) has started; new fatwas will appear in search progressively.',
    filesSelected: 'images selected',
    checking: 'Checking file names…',
    pagesDetected: 'Detected pages:',
    alreadyPresent: 'already stored',
    duplicateWarning: 'Duplicate page numbers:',
    rejectedFiles: 'file(s) skipped',
    missingPages: 'Numbers missing from the range:',
    fixDuplicates: 'Fix the file names before uploading: several images share the same page number.',
    autoRefresh: 'refreshes automatically',
    modePdf: 'Upload PDF',
    modeImages: 'Upload images',
    pdfHint:
      'The whole PDF, as is: far lighter to transfer than the images it contains. The server extracts pages as lossless PNG, numbering comes from the PDF.',
    pdfStart: 'Upload PDF and start processing',
    pdfDone:
      'PDF uploaded. Page extraction has started, then OCR, structuring and indexing follow; progress is shown below.',
    errorNetwork: 'Connection error, please retry.',
    rateLimited: 'Too many requests, wait a minute.',
    disclaimer:
      'Documentary assistant: it reports the content of the cited fatwas and does not replace a scholar’s advice.',
    askTab: 'Question & answer',
    searchTab: 'Search',
    vowelsTab: 'Vowels',
    vowelsTitle: 'Add vowels to an Arabic text',
    vowelsHint:
      'Paste up to three pages of Arabic: it comes back fully vowelled, so it can be read aloud without case-ending mistakes. The text is neither altered nor stored.',
    vowelsPlaceholder: 'Paste the Arabic text to vowelise here…',
    vowelsChars: 'characters',
    vowelsTooLong: 'Text too long: remove some of it.',
    vowelsUploadHint: 'Photo or PDF, 3 pages at most. The text read appears below — correct it if needed before adding vowels.',
    vowelsReading: 'Reading page',
    vowelsBadType: 'Unsupported format: image (PNG, JPEG, WEBP, TIFF) or PDF.',
    vowelsNoText: 'No readable Arabic text on this page.',
    vowelsStart: 'Add vowels',
    vowelsWorking: 'Working…',
    vowelsDone: 'words vowelled',
    vowelsRefused: 'word(s) left unvowelled: the model had altered them, the original was restored.',
    vowelsFaithful: 'Text returned unchanged, apart from the vowel marks.',
    copy: 'Copy',
    copied: 'Copied',
    searchTitle: 'Search the fatwas',
    searchBody:
      'Fatwas are shown exactly as written, with no generated answer: describe the topic you are looking for, in English or in Arabic.',
    searchPlaceholder: 'Keyword or topic…',
    searchAction: 'Search',
    searching: 'Searching…',
    noResults: 'No fatwa found',
    resultsCount: 'fatwas found',
    subQuestion: 'Question',
    questionLabel: 'Question',
    answerLabel: 'Answer',
    readMore: 'Read the fatwa',
    readLess: 'Collapse',
    adminTitle: 'Administration',
    themesTab: 'Themes',
    themesTitle: 'Taxonomy applied when structuring',
    themesHint:
      'Three mandatory levels: chapter and section come from this closed list, the precise topic stays free (two to five words). A label outside the list is cleared rather than forced onto a near match, and the fatwa shows up in the report.',
    themesChapters: 'chapters',
    themesSections: 'sections',
    reportTab: 'Report',
    reportTitle: 'Incomplete fatwas',
    reportCollection: 'collection',
    reportRefresh: 'Refresh',
    reportLoading: 'Scanning the collection…',
    reportBook: 'Book',
    reportNoNumber: 'no number',
    reportNoTheme1: 'no theme 1',
    reportNoTheme2: 'no theme 2',
    reportNoTheme3: 'no theme 3',
    reportNoQuestion: 'no question',
    reportNoAnswer: 'no answer',
    reportSamples: 'Samples',
    clearedIdle: 'Conversation cleared after 3 minutes of inactivity.',
    clearedFull: 'New conversation: the previous one reached 10 messages.',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    fatwaPages: 'page',
    spansPages: 'This fatwa spans pages',
    aroundPage: 'neighbouring page',
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
    signInFailed: 'تعذّر تسجيل الدخول. الرمز الذي أرجعته Google:',
    origine: { numero: 'رقم مطابق', mots: 'كلمات', sens: 'معنى', 'mots+sens': 'كلمات ومعنى' },
    signOut: 'تسجيل الخروج',
    notAllowed: 'هذا الحساب غير مصرّح له بالدخول إلى فتاوى.',
    sessionExpired: 'انتهت الجلسة، أعد تسجيل الدخول.',
    loading: 'جارٍ التحميل…',
    addFatwas: 'إضافة فتاوى',
    uploadTitle: 'إضافة فتاوى',
    backToChat: 'رجوع إلى البحث',
    bookName: 'الكتاب (المجموعة)',
    bookPlaceholder: 'عنوان المجموعة الجديدة',
    bookNew: 'كتاب جديد',
    fileNameHint: 'يجب أن يحتوي اسم كل صورة على رقم الصفحة (مثال: page_012.png).',
    uploadStart: 'إرسال الصفحات',
    uploading: 'جارٍ الإرسال…',
    uploadDone: 'تم إرسال الصفحات. بدأت المعالجة (المسح الضوئي، التنظيم، الفهرسة)؛ ستظهر الفتاوى الجديدة في البحث تدريجياً.',
    filesSelected: 'صورة محدّدة',
    checking: 'جارٍ التحقّق من أسماء الملفات…',
    pagesDetected: 'الصفحات المكتشفة:',
    alreadyPresent: 'موجودة مسبقاً',
    duplicateWarning: 'أرقام صفحات مكرّرة:',
    rejectedFiles: 'ملف/ملفات مستبعدة',
    missingPages: 'أرقام ناقصة في التسلسل:',
    fixDuplicates: 'صحّح أسماء الملفات قبل الإرسال: عدة صور تحمل رقم الصفحة نفسه.',
    autoRefresh: 'يُحدَّث تلقائياً',
    modePdf: 'إرسال ملف PDF',
    modeImages: 'إرسال صور',
    pdfHint:
      'الملف كما هو: أخف بكثير من الصور التي يحتويها. يستخرج الخادم الصفحات بصيغة PNG دون فقدان، والترقيم مأخوذ من الملف.',
    pdfStart: 'إرسال الملف وبدء المعالجة',
    pdfDone: 'تم إرسال الملف. بدأ تقسيم الصفحات، ثم المسح الضوئي والتنظيم والفهرسة؛ يظهر التقدّم أدناه.',
    errorNetwork: 'خطأ في الاتصال، أعد المحاولة.',
    rateLimited: 'طلبات كثيرة، انتظر دقيقة.',
    disclaimer: 'مساعد وثائقي: ينقل مضمون الفتاوى المذكورة ولا يغني عن سؤال أهل العلم.',
    askTab: 'سؤال وجواب',
    searchTab: 'بحث',
    vowelsTab: 'التشكيل',
    vowelsTitle: 'تشكيل نصّ عربي',
    vowelsHint:
      'الصق ما يصل إلى ثلاث صفحات من النصّ العربي، فيُعاد إليك مشكولًا ليُقرأ جهرًا بلا خطأ في الإعراب. لا يُعدَّل النصّ ولا يُحفظ.',
    vowelsPlaceholder: 'الصق هنا النصّ العربي المطلوب تشكيله…',
    vowelsChars: 'حرفًا',
    vowelsTooLong: 'النصّ أطول من اللازم، احذف منه شيئًا.',
    vowelsUploadHint: 'صورة أو PDF، ثلاث صفحات على الأكثر. يظهر النصّ المقروء أدناه، فصحّحه إن لزم قبل التشكيل.',
    vowelsReading: 'قراءة الصفحة',
    vowelsBadType: 'صيغة غير مقبولة: صورة (PNG، JPEG، WEBP، TIFF) أو PDF.',
    vowelsNoText: 'لا يوجد نصّ عربي مقروء في هذه الصفحة.',
    vowelsStart: 'شكّل النصّ',
    vowelsWorking: 'جارٍ التشكيل…',
    vowelsDone: 'كلمة مشكولة',
    vowelsRefused: 'كلمة تُركت بلا تشكيل: غيّرها النموذج، فأُعيد الأصل.',
    vowelsFaithful: 'أُعيد النصّ كما هو، لم يُضف إليه غير علامات التشكيل.',
    copy: 'نسخ',
    copied: 'تم النسخ',
    searchTitle: 'البحث في الفتاوى',
    searchBody: 'تُعرض الفتاوى كما هي دون صياغة جديدة: اكتب الموضوع الذي تبحث عنه.',
    searchPlaceholder: 'كلمة مفتاحية أو موضوع…',
    searchAction: 'بحث',
    searching: 'جارٍ البحث…',
    noResults: 'لم يُعثر على فتوى',
    resultsCount: 'فتوى',
    subQuestion: 'السؤال',
    questionLabel: 'السؤال',
    answerLabel: 'الجواب',
    readMore: 'قراءة الفتوى',
    readLess: 'طيّ',
    adminTitle: 'الإدارة',
    themesTab: 'الموضوعات',
    themesTitle: 'تصنيف الموضوعات المعتمد',
    themesHint:
      'ثلاثة مستويات إلزامية: الباب والقسم من هذه القائمة المغلقة، والموضوع الدقيق حر (كلمتان إلى خمس). ما خرج عن القائمة يُترك فارغاً ويظهر في التقرير.',
    themesChapters: 'أبواب',
    themesSections: 'أقسام',
    reportTab: 'التقرير',
    reportTitle: 'فتاوى ناقصة',
    reportCollection: 'المجموعة',
    reportRefresh: 'تحديث',
    reportLoading: 'جارٍ فحص المجموعة…',
    reportBook: 'الكتاب',
    reportNoNumber: 'بلا رقم',
    reportNoTheme1: 'بلا باب',
    reportNoTheme2: 'بلا قسم',
    reportNoTheme3: 'بلا موضوع',
    reportNoQuestion: 'بلا سؤال',
    reportNoAnswer: 'بلا جواب',
    reportSamples: 'أمثلة',
    clearedIdle: 'حُذفت المحادثة بعد ثلاث دقائق من الخمول.',
    clearedFull: 'محادثة جديدة: بلغت السابقة عشر رسائل.',
    previousPage: 'الصفحة السابقة',
    nextPage: 'الصفحة التالية',
    fatwaPages: 'صفحة',
    spansPages: 'تمتد هذه الفتوى على الصفحات',
    aroundPage: 'صفحة مجاورة',
  },
};
