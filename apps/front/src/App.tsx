import { useEffect, useRef, useState } from 'react';
import { ApiError, ask } from './api.js';
import { DICT, type Lang } from './i18n.js';
import type { AskSource, ChatMessage } from './types.js';

const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
];

function SourceCard({ source, t }: { source: AskSource; t: (typeof DICT)['fr'] }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
          {t.fatwa} {source.numero_fatwa || '—'}
        </span>
        {source.livre_titre && <span>{source.livre_titre}</span>}
        {source.numero_page != null && (
          <span>
            {t.page} {source.numero_page}
          </span>
        )}
      </div>
      {source.citation_arabe && (
        <p dir="rtl" className="texte-arabe mb-2 text-stone-800">
          {source.citation_arabe}
        </p>
      )}
      {source.url_image && (
        <a
          href={source.url_image}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900"
        >
          {t.viewPage}
        </a>
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('fataawa.lang', lang);
  }, [lang]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(question: string) {
    const clean = question.trim();
    if (clean === '' || loading) return;
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', texte: clean }]);
    setLoading(true);
    try {
      const res = await ask(clean, conversationId, lang);
      setConversationId(res.conversationId);
      localStorage.setItem('fataawa.conversation', res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          texte: res.reponse_utilisateur,
          sources: res.sources_utilisees,
          suggestions: res.suggestions_cliquables,
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t.rateLimited : t.errorNetwork);
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

  const derniersSuggestions =
    messages.length > 0 ? (messages[messages.length - 1]?.suggestions ?? []) : [];

  return (
    <div className="flex min-h-dvh flex-col bg-stone-100 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-xl font-bold text-emerald-800">{t.appTitle}</h1>
            <p className="text-xs text-stone-500">{t.tagline}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={nouvelleConversation}
              className="rounded-md border border-stone-300 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              {t.newChat}
            </button>
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
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {messages.length === 0 && !loading && (
          <div className="mt-16 text-center">
            <h2 className="text-2xl font-semibold text-stone-700">{t.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{t.emptyBody}</p>
          </div>
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
                  {m.sources && m.sources.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                        {t.sources}
                      </p>
                      {m.sources.map((s, j) => (
                        <SourceCard key={j} source={s} t={t} />
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

        {derniersSuggestions.length > 0 && !loading && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              {t.suggestions}
            </p>
            <div className="flex flex-wrap gap-2">
              {derniersSuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => void send(s)}
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
      </main>

      <footer className="sticky bottom-0 border-t border-stone-200 bg-white">
        <form
          className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.inputPlaceholder}
            dir="auto"
            className="flex-1 rounded-full border border-stone-300 bg-stone-50 px-4 py-2.5 outline-none focus:border-emerald-500 focus:bg-white"
          />
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
    </div>
  );
}
