'use client';

import { memo, useState } from 'react';
import { Icon } from '@/components/Icon';
import QrModal from '@/components/QrModal';
import { useCopy } from '@/lib/hooks';

function InvitePanel({ code, protectedRoom }: { code: string; protectedRoom: boolean }) {
  const [codeCopied, copyCode] = useCopy();
  const [linkCopied, copyLink] = useCopy();
  const [qr, setQr] = useState(false);
  const link = typeof window !== 'undefined' ? `${window.location.origin}/sala/${code}` : '';

  return (
    <section className="card p-4" aria-label="Convidar amigos">
      <h2 className="text-base font-black">Convide os amigos</h2>
      <p className="mt-2 rounded-xl border-2 border-ink bg-brand-50 py-2 text-center font-mono text-3xl font-black tracking-[0.3em]" aria-label={`Código da sala ${code.split('').join(' ')}`}>
        {code}
      </p>
      {protectedRoom && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
          <Icon name="lock" size={14} />
          Sala protegida por senha
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-sm" onClick={() => copyCode(code)}>
          <Icon name={codeCopied ? 'check' : 'copy'} size={16} />
          {codeCopied ? 'Copiado' : 'Copiar código'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => copyLink(link)}>
          <Icon name={linkCopied ? 'check' : 'link'} size={16} />
          {linkCopied ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      <button type="button" className="btn btn-sm mt-2 w-full" onClick={() => setQr(true)}>
        <Icon name="qr" size={16} />
        Gerar QR Code
      </button>
      <p className="mt-2 break-all text-xs font-medium text-zinc-600">{link}</p>
      {qr && <QrModal link={link} onClose={() => setQr(false)} />}
    </section>
  );
}

export default memo(InvitePanel);
