import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import Admin from './Admin.js';
import { ApiError, ask } from './api.js';
import { observerUtilisateur } from './auth.js';
import { estCheminAdmin } from './config.js';
import { DICT, type Lang } from './i18n.js';
import PageViewer from './PageViewer.js';
import Recherche from './Recherche.js';
import type { AskSource, ScanRef, ChatMessage } from './types.js';

/**
 * Une conversation ne survit pas à trois minutes sans activité, et ne dépasse
 * pas dix messages. Deux raisons : personne ne revient sur un fil abandonné, et
 * plus l'historique s'allonge, plus le modèle traîne le contexte des questions
 * précédentes dans des réponses qui n'ont plus rien à voir.
 */
const INACTIVITE_MS = 3 * 60_000;
const MESSAGES_MAX = 10;
/** Une question, pas un texte à commenter. Le serveur applique la même borne. */
const LONGUEUR_MAX = 500;

const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
];

function SourceCard({
  source,
  t,
  onOpen,
}: {
  source: AskSource;
  t: (typeof DICT)['fr'];
  onOpen: () => void;
}) {
  const cliquable = source.url_image !== null;
  return (
    <div
      onClick={cliquable ? onOpen : undefined}
      className={`rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm ${
        cliquable ? 'cursor-pointer transition hover:border-emerald-400 hover:bg-emerald-50/40' : ''
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
          {t.fatwa} {source.numero_fatwa || '—'}
        </span>
        {source.livre_titre && <span>{source.livre_titre}</span>}
      </div>
      {source.citation_arabe && (
        <p dir="rtl" className="texte-arabe mb-2 text-stone-800">
          {source.citation_arabe}
        </p>
      )}
      {cliquable && (
        <span className="text-xs font-medium text-emerald-700 underline">🖼 {t.viewPage}</span>
      )}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('fataawa.lang');
    return saved === 'fr' || saved === 'en' || saved === 'ar' ? saved : 'fr';
  });
  const t = DICT[lang];
  const [conversationId, setConversationId] = useState<string | null>(
    () => localStorage.getItem('fataawa.conversation'),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageOuverte, setPageOuverte] = useState<ScanRef | null>(null);
  /** Affiché une fois, quand la conversation vient d'être effacée d'elle-même. */
  const [effacee, setEffacee] = useState<'inactivite' | 'plein' | null>(null);
  const [utilisateur, setUtilisateur] = useState<User | null>(null);
  // deux usages distincts qui cohabitent : poser une question, ou fouiller
  // directement le corpus. L'administration, elle, vit sur une adresse à part
  // qu'aucun lien ne donne — d'où la lecture de l'URL plutôt qu'un bouton.
  const [vue, setVue] = useState<'chat' | 'recherche'>('chat');
  const [admin, setAdmin] = useState(() => estCheminAdmin(window.location.pathname));

  // le retour arrière du navigateur doit sortir de l'administration
  useEffect(() => {
    const onPop = () => setAdmin(estCheminAdmin(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => observerUtilisateur(setUtilisateur), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('fataawa.lang', lang);
  }, [lang]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  // Effacement après inactivité : le minuteur repart à chaque message, donc une
  // conversation suivie n'est jamais coupée — seul un fil laissé de côté part.
  useEffect(() => {
    if (messages.length === 0) return;
    const t = window.setTimeout(() => {
      setMessages([]);
      setConversationId(null);
      localStorage.removeItem('fataawa.conversation');
      setEffacee('inactivite');
    }, INACTIVITE_MS);
    return () => window.clearTimeout(t);
  }, [messages]);

  async function send(question: string, confirmee = false) {
    const clean = question.trim().slice(0, LONGUEUR_MAX);
    if (clean === '' || loading) return;
    setError(null);
    setEffacee(null);
    setInput('');
    // Dix messages atteints : on repart d'une conversation neuve plutôt que de
    // tronquer l'historique en silence, ce qui donnerait des réponses qui
    // s'appuient sur un contexte à moitié perdu.
    const plein = messages.length >= MESSAGES_MAX;
    const fil = plein ? null : conversationId;
    if (plein) {
      localStorage.removeItem('fataawa.conversation');
      setEffacee('plein');
    }
    setMessages((prev) => (plein ? [{ role: 'user', texte: clean }] : [...prev, { role: 'user', texte: clean }]));
    setLoading(true);
    try {
      const res = await ask(clean, fil, lang, confirmee);
      setConversationId(res.conversationId);
      localStorage.setItem('fataawa.conversation', res.conversationId);
      if (res.type === 'clarification') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            texte: res.message,
            clarification: {
              question_proposee: res.question_proposee,
              autres_interpretations: res.autres_interpretations,
            },
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            texte: res.reponse_utilisateur,
            sources: res.sources_utilisees,
            suggestions: res.suggestions_cliquables,
          },
        ]);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError(t.notAllowed);
      else if (err instanceof ApiError && err.status === 401) setError(t.sessionExpired);
      else if (err instanceof ApiError && err.status === 429) setError(t.rateLimited);
      else setError(t.errorNetwork);
    } finally {
      setLoading(false);
    }
  }

  function nouvelleConversation() {
    setMessages([]);
    setConversationId(null);
    setError(null);
    localStorage.removeItem('fataawa.conversation');
  }

  const dernier = messages[messages.length - 1];
  const derniersSuggestions = dernier?.suggestions ?? [];
  const clarificationActive = !loading && dernier?.role === 'assistant' ? dernier.clarification : undefined;

  // La consultation est publique ; l'administration exige un compte autorisé.
  if (admin) {
    return (
      <Admin
        t={t}
        utilisateur={utilisateur}
        onQuitter={() => {
          window.history.pushState({}, '', '/');
          setAdmin(false);
        }}
      />
    );
  }

  return (
    // hauteur exacte du viewport : seule la zone des messages défile, sinon le
    // footer rogne la fin des réponses (d'autant plus que le header FR est haut)
    <div className="flex h-dvh flex-col overflow-hidden bg-stone-100 text-stone-900">
      <header className="shrink-0 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-xl font-bold text-emerald-800">{t.appTitle}</h1>
            <p className="text-xs text-stone-500">{t.tagline}</p>
          </div>
          <div className="flex items-center gap-2">
            {vue === 'chat' && (
              <button
                onClick={nouvelleConversation}
                className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
              >
                {t.newChat}
              </button>
            )}
            <div className="flex overflow-hidden rounded-md border border-stone-300">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`px-2.5 py-1.5 text-xs font-medium ${
                    lang === l.code ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* les deux usages cohabitent : on passe de l'un à l'autre sans rien perdre */}
        <div className="mx-auto max-w-3xl px-4 pb-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-stone-300">
            {([
              ['chat', t.askTab],
              ['recherche', t.searchTab],
            ] as const).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setVue(code)}
                className={`px-3 py-1.5 text-xs font-medium ${
                  vue === code ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {vue === 'recherche' ? (
          <Recherche t={t} onVoirPage={setPageOuverte} />
        ) : (
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {messages.length === 0 && !loading && (
          <div className="mt-16 text-center">
            <h2 className="text-2xl font-semibold text-stone-700">{t.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{t.emptyBody}</p>
          </div>
        )}

        {effacee !== null && (
          <p className="mb-4 rounded-md border border-stone-200 bg-white px-3 py-2 text-center text-xs text-stone-500">
            {effacee === 'inactivite' ? t.clearedIdle : t.clearedFull}
          </p>
        )}

        <div className="space-y-4">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-ee-sm bg-emerald-700 px-4 py-2.5 text-white">
                  <p dir="auto" className="whitespace-pre-wrap">
                    {m.texte}
                  </p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[95%] space-y-3 rounded-2xl rounded-ss-sm border border-stone-200 bg-white px-4 py-3 shadow-sm">
                  <p dir="auto" className="texte-arabe whitespace-pre-wrap">
                    {m.texte}
                  </p>
                  {m.clarification && (
                    <p
                      dir="auto"
                      className="texte-arabe rounded-lg border-s-4 border-emerald-500 bg-emerald-50 px-3 py-2 font-medium text-emerald-900"
                    >
                      « {m.clarification.question_proposee} »
                    </p>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                        {t.sources}
                      </p>
                      {m.sources.map((s, j) => (
                        <SourceCard key={j} source={s} t={t} onOpen={() => setPageOuverte(s)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 shadow-sm">
                <span className="animate-pulse">{t.thinking}</span>
              </div>
            </div>
          )}
        </div>

        {clarificationActive && (
          <div className="mt-4 space-y-2">
            <button
              onClick={() => void send(clarificationActive.question_proposee, true)}
              dir="auto"
              className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              ✓ {t.clarifyYes}
            </button>
            {clarificationActive.autres_interpretations.length > 0 && (
              <>
                <p className="text-xs text-stone-500">{t.clarifyOr}</p>
                <div className="flex flex-wrap gap-2">
                  {clarificationActive.autres_interpretations.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => void send(q, true)}
                      dir="auto"
                      className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {derniersSuggestions.length > 0 && !loading && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              {t.suggestions}
            </p>
            <div className="flex flex-wrap gap-2">
              {derniersSuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => void send(s, true)}
                  dir="auto"
                  className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
          <div ref={bottomRef} />
        </div>
        )}
      </main>

      {vue === 'chat' && (
      <footer className="shrink-0 border-t border-stone-200 bg-white">
        <form
          className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, LONGUEUR_MAX))}
              maxLength={LONGUEUR_MAX}
              placeholder={t.inputPlaceholder}
              dir="auto"
              className="w-full rounded-full border border-stone-300 bg-stone-50 px-4 py-2.5 pe-16 outline-none focus:border-emerald-500 focus:bg-white"
            />
            {input.length > LONGUEUR_MAX - 100 && (
              <span className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-xs text-stone-400">
                {LONGUEUR_MAX - input.length}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || input.trim() === ''}
            className="rounded-full bg-emerald-700 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {t.send}
          </button>
        </form>
        <p className="mx-auto max-w-3xl px-4 pb-2 text-center text-[11px] text-stone-400">
          {t.disclaimer}
        </p>
      </footer>
      )}

      {pageOuverte && (
        <PageViewer source={pageOuverte} t={t} onClose={() => setPageOuverte(null)} />
      )}
    </div>
  );
}
