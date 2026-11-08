'use client';

import { memo, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ERROR_COPY, type ErrorKind } from '@/components/ErrorScreen';
import { useHostStats } from '@/lib/hooks';
import { formatKbps, supportsCamera, supportsDisplayCapture } from '@/lib/utils';
import { QUALITY_PROFILES, type QualityKey } from '@/lib/webrtc';
import type { RoomSession, Snapshot } from '@/lib/room-session';

/** Medidor do microfone com intervalo próprio: só ele re-renderiza 8 vezes por segundo. */
function MicMeter({ session, active }: { session: RoomSession; active: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const t = setInterval(() => setLevel(session.micLevel()), 120);
    return () => clearInterval(t);
  }, [active, session]);
  return (
    <div className="h-2.5 w-full min-w-[4rem] overflow-hidden rounded-full border-2 border-ink bg-white" role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="h-full bg-brand-600 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function HostStatsLine({ session, hasAudio }: { session: RoomSession; hasAudio: boolean }) {
  const s = useHostStats(session);
  return (
    <div className="rounded-xl border-2 border-ink/15 p-3 text-sm">
      <p className="font-bold">{s ? `${s.connected} de ${s.viewers} ${s.viewers === 1 ? 'espectador conectado' : 'espectadores conectados'}` : 'Medindo a transmissão'}</p>
      {s && (
        <p className="mt-0.5 text-xs font-medium text-zinc-700">
          Enviando {formatKbps(s.totalKbps)} no total
          {s.width && s.height ? `, ${s.width}x${s.height}` : ''}
          {s.fps ? `, ${s.fps} fps` : ''}
          {s.rttMs !== null ? `, ping médio de ${s.rttMs} ms` : ''}.
          {s.reduced ? ' A qualidade foi reduzida para manter a estabilidade da rede.' : ''}
          {s.cpuLimited ? ' O aparelho está no limite: a resolução foi reduzida. Se esquentar, escolha uma qualidade menor.' : ''}
        </p>
      )}
      <p className="mt-1 text-xs font-medium text-zinc-700">
        {hasAudio ? 'O áudio está sendo enviado em estéreo.' : 'Nenhum áudio está sendo enviado. Ligue o microfone ou compartilhe uma aba com “Compartilhar áudio”.'}
      </p>
    </div>
  );
}

function HostControls({ session, snap }: { session: RoomSession; snap: Snapshot }) {
  const h = snap.host;
  const canScreen = supportsDisplayCapture();
  const canCam = supportsCamera();
  const micUi = h.sharing ? h.micOn : h.micWanted;
  const err = h.shareError as ErrorKind | null;

  return (
    <section className="card space-y-4 p-4" aria-label="Controles da transmissão">
      {err && h.sharing && (
        <p role="alert" className="rounded-xl border-2 border-ink bg-brand-50 px-3 py-2 text-sm font-semibold">
          <span className="font-black">{ERROR_COPY[err].title}.</span> {ERROR_COPY[err].text}
        </p>
      )}

      {h.sharing ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => session.togglePause()}>
              <Icon name={h.paused ? 'play' : 'pause'} size={16} />
              {h.paused ? 'Retomar' : 'Pausar'}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => session.stopSharing()}>
              <Icon name="stop" size={16} />
              Parar transmissão
            </button>
          </div>

          <div>
            <p className="text-sm font-bold">Fonte do vídeo</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {canScreen && (
                <button type="button" className={`btn btn-sm ${h.source === 'screen' ? 'btn-dark' : ''}`} aria-pressed={h.source === 'screen'} disabled={h.busy} onClick={() => void session.startScreen()}>
                  <Icon name="monitor" size={16} />
                  {h.source === 'screen' ? 'Escolher outra tela' : 'Tela'}
                </button>
              )}
              {canCam && (
                <button type="button" className={`btn btn-sm ${h.source === 'camera' ? 'btn-dark' : ''}`} aria-pressed={h.source === 'camera'} disabled={h.busy || h.source === 'camera'} onClick={() => void session.startCamera()}>
                  <Icon name="camera" size={16} />
                  Câmera
                </button>
              )}
              {canCam && (h.source === 'camera' || h.cameraOn) && (
                <button type="button" className="btn btn-sm" disabled={h.busy} onClick={() => void session.switchCamera()}>
                  <Icon name="flip" size={16} />
                  Virar câmera
                </button>
              )}
              {canCam && h.source === 'screen' && (
                <button type="button" className={`btn btn-sm ${h.cameraOn ? 'btn-dark' : ''}`} aria-pressed={h.cameraOn} disabled={h.busy} onClick={() => void session.toggleCameraBubble()}>
                  <Icon name="camera" size={16} />
                  {h.cameraOn ? 'Tirar câmera da tela' : 'Câmera sobre a tela'}
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm font-semibold">Você não está transmitindo. Escolha tela ou câmera na área de vídeo acima.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm font-bold">Microfone</p>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" className={`btn btn-sm shrink-0 ${micUi ? 'btn-dark' : ''}`} aria-pressed={micUi} onClick={() => void session.toggleMic()}>
              <Icon name={micUi ? 'mic' : 'micOff'} size={16} />
              {micUi ? (h.sharing ? 'Ligado' : 'Ligado ao começar') : 'Desligado'}
            </button>
            <MicMeter session={session} active={h.micOn} />
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" className="h-4 w-4" checked={h.voiceFilter} onChange={(e) => void session.setVoiceFilter(e.target.checked)} />
            Melhorar a voz (cancelar eco e ruído)
          </label>
        </div>
        <label className="block text-sm font-bold">
          Qualidade máxima
          <select className="input mt-1 !py-2 text-base" value={h.quality} onChange={(e) => session.setQuality(e.target.value as QualityKey)}>
            {Object.values(QUALITY_PROFILES).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(!h.sharing || h.source === 'screen') && (
        <fieldset>
          <legend className="text-sm font-bold">O que você vai mostrar na tela</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(['detail', 'motion'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={h.mode === m} onClick={() => session.setMode(m)} className={`btn btn-sm ${h.mode === m ? 'btn-dark' : ''}`}>
                {m === 'detail' ? 'Texto e telas' : 'Jogos e vídeos'}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs font-medium text-zinc-600">
        A qualidade é um teto: o envio se ajusta sozinho à sua rede, ao desempenho do aparelho, ao número de espectadores e ao tamanho da tela de cada um.
        “Máxima” usa até 4K a 60 fps quando tudo aguenta. No celular, prefira 1080p.
      </p>

      {h.sharing && <HostStatsLine session={session} hasAudio={h.micOn || h.hasSystemAudio} />}
    </section>
  );
}

export default memo(HostControls);
