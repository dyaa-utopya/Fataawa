import { useEffect, useState } from 'react';
import type { DICT } from './i18n.js';
import type { ScanRef } from './types.js';

/**
 * Visionneuse plein écran du scan — partagée par le chat et la recherche.
 *
 * Elle FEUILLETTE, et ce n'est pas un ornement : une fatwa déborde très souvent
 * sur la page suivante. Montrer une seule page laissait le lecteur devant une
 * réponse coupée en bas de feuille, alors que le texte, lui, était complet.
 *
 * La navigation est BORNÉE aux pages de la fatwa, plus une page de part et
 * d'autre : de quoi lire la suite d'une réponse qui déborde, ou le contexte
 * immédiat, sans transformer la visionneuse en liseuse du recueil entier. Le
 * scan est servi par l'API à partir du livre et du numéro de page, qui renvoie
 * vers une URL signée.
 */
/** Pages offertes au-delà de celles que la fatwa occupe, de chaque côté. */
const MARGE = 1;
export default function PageViewer({
  source,
  t,
  onClose,
}: {
  source: ScanRef;
  t: (typeof DICT)['fr'];
  onClose: () => void;
}) {
  const pages = source.pages ?? [];
  const connues = pages.length > 0 ? pages : source.numero_page ? [source.numero_page] : [];
  const premiere = connues.length > 0 ? Math.min(...connues) : null;
  const borneMin = premiere === null ? null : Math.max(1, premiere - MARGE);
  const borneMax = connues.length > 0 ? Math.max(...connues) + MARGE : null;
  const [page, setPage] = useState<number | null>(premiere);
  const feuilletable =
    source.livre_id !== '' && page !== null && borneMin !== null && borneMax !== null;
  const reculPossible = feuilletable && page > (borneMin ?? page);
  const avancePossible = feuilletable && page < (borneMax ?? page);

  // l'URL directe ne vaut que pour la première page ; dès qu'on feuillette,
  // c'est l'API qui résout le scan à partir du numéro
  const src =
    feuilletable && page !== premiere
      ? `/api/v1/images/${encodeURIComponent(source.livre_id)}/${String(page).padStart(4, '0')}`
      : (source.url_image ??
        (feuilletable
          ? `/api/v1/images/${encodeURIComponent(source.livre_id)}/${String(page).padStart(4, '0')}`
          : null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // en lecture arabe, la page suivante est à gauche : on suit les flèches
      // telles qu'elles sont, sans inverser, pour rester prévisible
      if (e.key === 'ArrowRight' && avancePossible) setPage((p) => (p === null ? p : p + 1));
      if (e.key === 'ArrowLeft' && reculPossible) setPage((p) => (p === null ? p : p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, avancePossible, reculPossible]);

  const bouton =
    'rounded-md bg-white/15 px-2.5 py-1.5 text-xs text-white hover:bg-white/25 disabled:opacity-30';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-stone-900/90 p-3 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 pb-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium" dir="auto">
          {t.fatwa} {source.numero_fatwa || '—'}
          {source.livre_titre && ` · ${source.livre_titre}`}
        </p>
        <div className="flex items-center gap-2">
          {feuilletable && (
            <>
              <button
                onClick={() => reculPossible && setPage((p) => (p === null ? p : p - 1))}
                disabled={!reculPossible}
                className={bouton}
                title={t.previousPage}
              >
                ‹
              </button>
              {/* une page hors de la fatwa est signalée comme telle : le
                  lecteur doit savoir qu'il en est sorti */}
              <span className="text-xs text-stone-300">
                {t.fatwaPages} {page}
                {!connues.includes(page) && ` · ${t.aroundPage}`}
              </span>
              <button
                onClick={() => avancePossible && setPage((p) => (p === null ? p : p + 1))}
                disabled={!avancePossible}
                className={bouton}
                title={t.nextPage}
              >
                ›
              </button>
            </>
          )}
          {src !== null && (
            <a href={src} target="_blank" rel="noreferrer" className={bouton}>
              {t.openFull}
            </a>
          )}
          <button onClick={onClose} className={bouton}>
            ✕ {t.close}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {src !== null ? (
          <img
            key={src}
            src={src}
            alt={`${t.fatwa} ${source.numero_fatwa}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded bg-white object-contain shadow-2xl"
          />
        ) : (
          <p className="text-sm text-stone-300">{t.noImage}</p>
        )}
      </div>
      {feuilletable && connues.length > 1 && (
        <p className="pt-2 text-center text-xs text-stone-400">
          {t.spansPages} {connues.join(' · ')}
        </p>
      )}
    </div>
  );
}
