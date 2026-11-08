'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useCopy } from '@/lib/hooks';

export default function QrModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((mod) => {
        const QR: any = (mod as any).default ?? mod;
        return QR.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
      })
      .then((url: string) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="QR Code da sala" className="card w-full max-w-sm p-5 text-black" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">QR Code da sala</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="mt-4 grid aspect-square place-items-center overflow-hidden rounded-xl border-2 border-ink bg-white">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="QR Code com o link da sala" className="h-full w-full" />
          ) : failed ? (
            <p className="p-4 text-center text-sm font-semibold">Não foi possível gerar o QR Code. Copie o link abaixo.</p>
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-ink/20 border-t-brand-600" aria-label="Gerando QR Code" />
          )}
        </div>
        <p className="mt-3 break-all text-center text-xs font-semibold text-zinc-600">{link}</p>
        <button type="button" className="btn btn-primary mt-3 w-full" onClick={() => copy(link)}>
          <Icon name={copied ? 'check' : 'link'} size={16} />
          {copied ? 'Link copiado' : 'Copiar link'}
        </button>
      </div>
    </div>
  );
}
