'use client';

import { Icon } from '@/components/Icon';
import { formatKbps } from '@/lib/utils';
import { QUALITY_PROFILES, type QualityKey } from '@/lib/webrtc';
import type { RoomSession, Snapshot } from '@/lib/room-session';

export default function HostControls({ session, snap }: { session: RoomSession; snap: Snapshot }) {
  const h = snap.host;
  const s = h.stats;
  return (
    <section className="card space-y-4 p-4" aria-label="Controles da transmissão">
      <div className="flex flex-wrap items-center gap-2">
        {h.sharing ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => session.togglePause()}>
              <Icon name={h.paused ? 'play' : 'pause'} size={16} />
              {h.paused ? 'Retomar' : 'Pausar'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void session.switchSource()}>
              <Icon name="refresh" size={16} />
              Trocar fonte
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => session.stopSharing()}>
              <Icon name="stop" size={16} />
              Parar transmissão
            </button>
          </>
        ) : (
          <p className="text-sm font-semibold">Você não está transmitindo. Use o botão “Compartilhar tela” acima.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-bold">
          Qualidade máxima
          <select className="input mt-1 !py-2 text-sm" value={h.quality} onChange={(e) => session.setQuality(e.target.value as QualityKey)}>
            {Object.values(QUALITY_PROFILES).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="text-sm font-bold">O que você vai mostrar</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(['detail', 'motion'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={h.mode === m}
                onClick={() => session.setMode(m)}
                className={`btn btn-sm ${h.mode === m ? 'btn-dark' : ''}`}
              >
                {m === 'detail' ? 'Texto e telas' : 'Jogos e vídeos'}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-xs font-medium text-zinc-600">
        A qualidade é um teto: o envio se ajusta sozinho à sua rede e ao número de espectadores. “Texto e telas” prioriza nitidez; “Jogos e vídeos” prioriza fluidez.
      </p>

      {h.sharing && (
        <div className="rounded-xl border-2 border-ink/15 p-3 text-sm">
          <p className="font-bold">
            {s ? `${s.connected} de ${s.viewers} ${s.viewers === 1 ? 'espectador conectado' : 'espectadores conectados'}` : 'Medindo a transmissão'}
          </p>
          {s && (
            <p className="mt-0.5 text-xs font-medium text-zinc-700">
              Enviando {formatKbps(s.totalKbps)} no total
              {s.width && s.height ? `, ${s.width}x${s.height}` : ''}
              {s.fps ? `, ${s.fps} fps` : ''}
              {s.rttMs !== null ? `, ping médio de ${s.rttMs} ms` : ''}.
              {s.reduced ? ' A qualidade foi reduzida para manter a estabilidade.' : ''}
            </p>
          )}
          <p className="mt-1 text-xs font-medium text-zinc-700">
            {h.hasAudio
              ? 'O áudio está sendo enviado.'
              : 'Nenhum áudio foi capturado. Para enviar o som, use “Trocar fonte”, escolha uma aba e marque “Compartilhar áudio”.'}
          </p>
        </div>
      )}
    </section>
  );
}
