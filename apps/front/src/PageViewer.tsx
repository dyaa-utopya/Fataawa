import { useEffect } from 'react';
import type { DICT } from './i18n.js';
import type { ScanRef } from './types.js';

/**
 * Visionneuse plein écran de la page scannée — partagée par le chat et la
 * recherche : dans les deux cas, on part d'une fatwa et on veut voir le scan.
 */
export default function PageViewer({
  source,
  t,
  onClose,
}: {
  source: ScanRef;
  t: (typeof DICT)['fr'];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-stone-900/90 p-3 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 pb-2 text-white">
        {/* pas de numéro de page affiché : le rang du scan ne correspond pas à
            la pagination imprimée du livre, le scan lui-même fait référence */}
        <p className="text-sm font-medium" dir="auto">
          {t.fatwa} {source.numero_fatwa || '—'}
          {source.livre_titre && ` · ${source.livre_titre}`}
        </p>
        <div className="flex items-center gap-2">
          {source.url_image && (
            <a
              href={source.url_image}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-md bg-white/15 px-2.5 py-1.5 text-xs hover:bg-white/25"
            >
              {t.openFull}
            </a>
          )}
          <button
            onClick={onClose}
            className="rounded-md bg-white/15 px-2.5 py-1.5 text-xs hover:bg-white/25"
          >
            ✕ {t.close}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {source.url_image ? (
          <img
            src={source.url_image}
            alt={`${t.fatwa} ${source.numero_fatwa}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded bg-white object-contain shadow-2xl"
          />
        ) : (
          <p className="text-sm text-stone-300">{t.noImage}</p>
        )}
      </div>
    </div>
  );
}
