'use client';

import ErrorScreen, { type ErrorKind } from '@/components/ErrorScreen';
import { useRoomSession } from '@/lib/hooks';
import type { Snapshot } from '@/lib/room-session';
import JoinForm from './JoinForm';
import RoomView from './RoomView';

function RoomLoading() {
  return (
    <main className="grid min-h-dvh place-items-center p-4" aria-busy="true">
      <div className="card w-full max-w-md space-y-4 p-6">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-brand-600" />
        <p className="text-center font-black">Verificando a sala</p>
        <div className="space-y-2">
          <div className="h-3 animate-pulse rounded bg-ink/10" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-ink/10" />
        </div>
      </div>
    </main>
  );
}

function closedText(snap: Snapshot): string | undefined {
  if (snap.closedReason === 'host') return snap.role === 'host' ? 'Você encerrou a sala.' : 'O apresentador encerrou a sala. Obrigado por assistir!';
  if (snap.closedReason === 'expired') return 'A sala expirou por inatividade. Crie uma nova sala para transmitir de novo.';
  return undefined;
}

export default function RoomClient({ code }: { code: string }) {
  const { session, snap } = useRoomSession(code);

  switch (snap.phase) {
    case 'init':
    case 'checking':
      return <RoomLoading />;
    case 'error': {
      const kind = (snap.fatal ?? 'connection') as ErrorKind;
      const retry = kind === 'offline' || kind === 'connection' || kind === 'replaced' || kind === 'rate-limited' ? () => session.retry() : undefined;
      return <ErrorScreen kind={kind} description={kind === 'closed' ? closedText(snap) : undefined} onRetry={retry} />;
    }
    case 'ready':
    case 'joining':
      return <JoinForm snap={snap} onJoin={(name, password) => void session.join({ name, password })} />;
    default:
      return <RoomView session={session} snap={snap} />;
  }
}
