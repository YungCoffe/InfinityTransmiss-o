import { Icon } from './Icon';
import { SantaHat } from './Christmas';
import { StatusDot } from './StatusDot';
import { CHRISTMAS } from '@/lib/theme';
import type { Participant } from '@/lib/types';

export default function ParticipantList({ participants, youId }: { participants: Participant[]; youId?: string }) {
  const viewers = participants.filter((p) => p.role === 'viewer' && p.status !== 'disconnected').length;
  return (
    <section className="card p-4" aria-label="Participantes">
      <h2 className="flex items-center gap-2 text-base font-black">
        <Icon name="users" size={18} />
        Participantes
        <span className="chip ml-auto">{viewers} {viewers === 1 ? 'espectador' : 'espectadores'}</span>
      </h2>
      <ul className="mt-3 space-y-2">
        {participants.length === 0 && <li className="text-sm text-zinc-600">Ninguém conectado ainda.</li>}
        {participants.map((p) => (
          <li key={p.clientId} className="flex items-center gap-3 rounded-xl border-2 border-ink/15 px-2.5 py-2">
            <span
              className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-black ${
                p.role === 'host' ? 'bg-brand-600 text-white' : 'bg-white text-black'
              }`}
            >
              {(p.name[0] || '?').toUpperCase()}
              {p.role === 'host' && CHRISTMAS && <SantaHat className="absolute -right-2 -top-3.5 h-5 w-5 rotate-[14deg]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">
                {p.name}
                {p.clientId === youId && <span className="font-medium text-zinc-500"> (você)</span>}
              </span>
              <span className="block text-xs font-medium text-zinc-600">{p.role === 'host' ? 'Apresentador' : 'Espectador'}</span>
            </span>
            <StatusDot status={p.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
