'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { StatusDot } from '@/components/StatusDot';
import ParticipantList from '@/components/ParticipantList';
import Stage from './Stage';
import HostControls from './HostControls';
import InvitePanel from './InvitePanel';
import Notices from './Notices';
import { useKeepAlive, useWakeLock } from '@/lib/hooks';
import type { RoomSession, Snapshot } from '@/lib/room-session';

export default function RoomView({ session, snap }: { session: RoomSession; snap: Snapshot }) {
  const isHost = snap.role === 'host';
  const sharing = isHost && snap.host.sharing;
  const watching = !isHost && snap.viewer.media === 'connected';

  useWakeLock(sharing || watching);
  useKeepAlive(sharing);

  // Fechar a aba do apresentador derruba a transmissão: pede confirmação.
  useEffect(() => {
    if (!sharing) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [sharing]);

  const code = snap.info?.code ?? session.code;

  return (
    <div className="min-h-dvh">
      <div className="candy" aria-hidden="true" />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-3 py-2.5 pt-4 sm:px-5">
          <Link
            href="/"
            aria-label="Voltar ao início"
            onClick={(e) => {
              if (sharing && !window.confirm('Sair da sala vai parar a transmissão. Continuar?')) e.preventDefault();
            }}
          >
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="chip font-mono">{code}</span>
            <StatusDot status={snap.link} className="hidden sm:inline-flex" />
            <StatusDot status={snap.link} showLabel={false} className="sm:hidden" />
            {isHost ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (window.confirm('Encerrar a sala para todos? A transmissão será interrompida.')) session.closeRoom();
                }}
              >
                <Icon name="x" size={16} />
                Encerrar sala
              </button>
            ) : (
              <Link href="/" className="btn btn-sm">
                <Icon name="logout" size={16} />
                Sair
              </Link>
            )}
          </div>
        </div>
      </header>

      {snap.link !== 'connected' && (
        <p role="status" className="border-b-2 border-ink bg-amber-300 px-4 py-2 text-center text-sm font-bold">
          {snap.link === 'disconnected' ? 'Desconectado do servidor. Tentando voltar.' : 'Reconectando ao servidor. O vídeo continua se a conexão direta estiver estável.'}
        </p>
      )}

      <main className="mx-auto grid max-w-[1500px] gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-4">
          <Stage session={session} snap={snap} />
          {isHost && <HostControls session={session} snap={snap} />}
        </section>
        <aside className="space-y-4">
          <InvitePanel code={code} protectedRoom={!!snap.info?.passwordRequired} />
          <ParticipantList participants={snap.participants} youId={snap.you?.clientId} />
          <Notices host={isHost} />
        </aside>
      </main>
    </div>
  );
}
