'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import ErrorScreen, { type ErrorKind } from '@/components/ErrorScreen';
import { formatKbps, lsGet, lsSet, supportsCamera, supportsDisplayCapture } from '@/lib/utils';
import { useViewerStats } from '@/lib/hooks';
import type { RoomSession, Snapshot } from '@/lib/room-session';
import type { LinkQuality } from '@/lib/webrtc';

const QUALITY_LABEL: Record<LinkQuality, string> = { excellent: 'Excelente', good: 'Boa', fair: 'Instável', poor: 'Ruim' };
const QUALITY_COLOR: Record<LinkQuality, string> = { excellent: 'bg-emerald-500', good: 'bg-lime-400', fair: 'bg-amber-400', poor: 'bg-red-600' };
const BLOCKING: ErrorKind[] = ['permission', 'capture', 'camera-denied', 'camera-missing', 'camera-busy'];

interface Overlay {
  title: string;
  text?: string;
  spinner?: boolean;
  action?: { label: string; onClick: () => void };
}

/** Indicador e painel de qualidade em componentes próprios: as métricas mudam a cada 2 s sem re-renderizar o palco. */
function LinkBadge({ session, onToggle, open }: { session: RoomSession; onToggle: () => void; open: boolean }) {
  const vs = useViewerStats(session);
  return (
    <button type="button" className="ctl gap-1.5 !px-2.5 text-xs font-bold" onClick={onToggle} aria-expanded={open} aria-label="Qualidade da conexão">
      <span className={`h-2.5 w-2.5 rounded-full border border-white ${vs ? QUALITY_COLOR[vs.quality] : 'bg-zinc-400'}`} />
      {vs ? QUALITY_LABEL[vs.quality] : 'Medindo'}
    </button>
  );
}

function StatsPanel({ session }: { session: RoomSession }) {
  const vs = useViewerStats(session);
  if (!vs) return null;
  return (
    <dl className="absolute bottom-14 right-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 rounded-xl border-2 border-white bg-black/90 p-3 text-xs text-white">
      <dt className="text-white/70">Resolução</dt>
      <dd className="font-bold">{vs.width ? `${vs.width}x${vs.height}` : '-'}</dd>
      <dt className="text-white/70">Quadros por segundo</dt>
      <dd className="font-bold">{vs.fps || '-'}</dd>
      <dt className="text-white/70">Taxa de vídeo</dt>
      <dd className="font-bold">{formatKbps(vs.kbps)}</dd>
      <dt className="text-white/70">Perda de pacotes</dt>
      <dd className="font-bold">{vs.lossPct}%</dd>
      <dt className="text-white/70">Latência estimada</dt>
      <dd className="font-bold">{vs.latencyMs !== null ? `${vs.latencyMs} ms` : '-'}</dd>
      <dt className="text-white/70">Ping</dt>
      <dd className="font-bold">{vs.rttMs !== null ? `${vs.rttMs} ms` : '-'}</dd>
    </dl>
  );
}

/** Tela inicial do apresentador: escolher tela ou câmera, e se o microfone entra junto. */
function HostStart({ session, snap }: { session: RoomSession; snap: Snapshot }) {
  const h = snap.host;
  const canScreen = supportsDisplayCapture();
  const canCam = supportsCamera();
  const [last, setLast] = useState<'screen' | 'camera'>('screen');
  const err = h.shareError as ErrorKind | null;
  const blocking = !!err && BLOCKING.includes(err);
  const micNote = err === 'mic-denied' || err === 'mic-missing';

  if (!canScreen && !canCam) {
    return (
      <ErrorScreen
        kind="unsupported"
        compact
        hideHome
        description="Este navegador ou dispositivo não permite compartilhar a tela nem usar a câmera. Use uma versão atual do Chrome, Edge, Firefox ou Safari e abra o site em HTTPS."
      />
    );
  }

  const go = (kind: 'screen' | 'camera') => {
    setLast(kind);
    void (kind === 'screen' ? session.startScreen() : session.startCamera());
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-4 p-5 text-center">
      {blocking && <ErrorScreen kind={err as ErrorKind} compact hideHome onRetry={() => go(last)} retryLabel="Tentar de novo" />}
      {micNote && (
        <p role="alert" className="rounded-xl border-2 border-white bg-brand-700 px-3 py-2 text-sm font-semibold">
          {err === 'mic-denied' ? 'O microfone está bloqueado neste site. Libere-o nas configurações do navegador.' : 'Nenhum microfone foi encontrado.'}
        </p>
      )}
      <div>
        <h2 className="text-2xl font-black">Pronto para transmitir</h2>
        <p className="mt-1 text-sm font-medium text-white/80">
          {canScreen
            ? 'Compartilhe a tela inteira, uma janela ou uma aba, ou use a câmera. Depois você ainda pode juntar a câmera à tela.'
            : 'Compartilhar a tela não está disponível neste aparelho (comum no celular). Use a câmera ou abra a sala em um computador para compartilhar a tela.'}
        </p>
      </div>
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        {canScreen && (
          <button type="button" className="btn btn-primary btn-lg !border-white !shadow-[4px_4px_0_0_#fff]" disabled={h.busy} onClick={() => go('screen')}>
            <Icon name="monitor" size={22} />
            Compartilhar tela
          </button>
        )}
        {canCam && (
          <button
            type="button"
            className={`btn btn-lg ${canScreen ? '' : 'btn-primary !border-white !shadow-[4px_4px_0_0_#fff]'}`}
            disabled={h.busy}
            onClick={() => go('camera')}
          >
            <Icon name="camera" size={22} />
            Usar câmera
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => void session.toggleMic()}
        aria-pressed={h.micWanted}
        className={`chip cursor-pointer ${h.micWanted ? '!bg-brand-600 !text-white !border-white' : ''}`}
      >
        <Icon name={h.micWanted ? 'mic' : 'micOff'} size={14} />
        {h.micWanted ? 'Microfone ligado ao transmitir' : 'Microfone desligado'}
      </button>
      <p className="text-xs font-medium text-white/70">Mantenha esta aba aberta enquanto transmite.</p>
    </div>
  );
}

function Stage({ session, snap }: { session: RoomSession; snap: Snapshot }) {
  const isHost = snap.role === 'host';
  const h = snap.host;
  const stream = isHost ? h.localStream : snap.viewer.mediaStream;
  const camStream = isHost ? h.localCamera : snap.stream.camera ? snap.viewer.cameraStream : null;
  const hostPart = snap.participants.find((p) => p.role === 'host');
  const hostName = hostPart?.name ?? snap.info?.hostName ?? 'Apresentador';
  const hostStatus = hostPart?.status ?? 'disconnected';
  const viewerCount = snap.participants.filter((p) => p.role === 'viewer' && p.status !== 'disconnected').length;
  const mirror = isHost && h.facing === 'user'; // só a prévia do apresentador é espelhada (como um espelho)

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  const [hasFrames, setHasFrames] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [blocked, setBlocked] = useState(false);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [pipOk, setPipOk] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [bubbleBig, setBubbleBig] = useState(false);

  useEffect(() => {
    const saved = lsGet('itx:vol');
    if (saved !== null) setVolume(Math.min(1, Math.max(0, Number(saved) || 0)));
    setPipOk(!!(document as any).pictureInPictureEnabled);
  }, []);

  // Liga o vídeo ao MediaStream. Se o navegador bloquear o som automático, começa mudo e mostra um aviso.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setHasFrames(false);
    if (v.srcObject !== stream) v.srcObject = stream;
    if (!stream) return;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      setBlocked(true);
      v.play().catch(() => {});
    });
  }, [stream]);

  useEffect(() => {
    const v = camRef.current;
    if (!v) return;
    if (v.srcObject !== camStream) v.srcObject = camStream;
    if (camStream) v.play().catch(() => {});
  }, [camStream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = isHost || muted; // a prévia do apresentador é sempre muda para não gerar eco
    v.volume = volume;
  }, [muted, volume, isHost, stream]);

  // Ao voltar para a aba, garante que o vídeo continue tocando.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        videoRef.current?.play().catch(() => {});
        camRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const onChange = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Em tela cheia, os controles somem após alguns segundos sem movimento ou toque.
  useEffect(() => {
    if (!fs) {
      setIdle(false);
      return;
    }
    const el = containerRef.current;
    let t = setTimeout(() => setIdle(true), 3000);
    const bump = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    el?.addEventListener('pointermove', bump);
    el?.addEventListener('pointerdown', bump);
    return () => {
      clearTimeout(t);
      el?.removeEventListener('pointermove', bump);
      el?.removeEventListener('pointerdown', bump);
    };
  }, [fs]);

  // Controles de mídia do sistema (útil para continuar ouvindo com a tela bloqueada, onde o navegador permitir).
  useEffect(() => {
    if (isHost || !snap.viewer.mediaStream || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `Transmissão de ${hostName}`, artist: 'infinityTransmissão' });
    } catch {
      /* não suportado */
    }
    return () => {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        /* ignora */
      }
    };
  }, [isHost, snap.viewer.mediaStream, hostName]);

  const toggleMute = () => {
    setMuted((m) => !m);
    setBlocked(false);
    videoRef.current?.play().catch(() => {});
  };
  const changeVolume = (value: number) => {
    setVolume(value);
    lsSet('itx:vol', String(value));
    if (value > 0 && muted) setMuted(false);
  };

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const v = videoRef.current as any;
    const orientation: any = typeof screen !== 'undefined' ? (screen as any).orientation : null;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        orientation?.unlock?.();
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen();
        // No celular, vídeo horizontal em tela cheia deita a tela (onde o navegador permite).
        if (v && v.videoWidth >= v.videoHeight) await orientation?.lock?.('landscape').catch(() => {});
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen(); // iPhone: só o elemento <video> entra em tela cheia
      }
    } catch {
      /* o navegador recusou */
    }
  }, []);

  const togglePip = async () => {
    const v = videoRef.current as any;
    try {
      if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture();
      else await v?.requestPictureInPicture();
    } catch {
      /* indisponível agora */
    }
  };

  /* ------------------------------------------------------------- avisos sobre o vídeo */
  let overlay: Overlay | null = null;
  if (isHost) {
    if (h.sharing && h.paused) overlay = { title: 'Transmissão pausada', text: 'Os espectadores veem um aviso de pausa. Clique em Retomar para continuar.' };
  } else if (!snap.stream.streaming) {
    overlay =
      hostStatus === 'connected'
        ? { title: 'Aguardando o apresentador', text: `${hostName} ainda não iniciou a transmissão.`, spinner: true }
        : hostStatus === 'reconnecting'
          ? { title: 'O apresentador perdeu a conexão', text: 'Aguardando a reconexão.', spinner: true }
          : { title: 'O apresentador saiu da sala', text: 'A transmissão volta quando ele entrar de novo.' };
  } else if (snap.stream.paused) {
    overlay = { title: 'Transmissão pausada', text: `${hostName} pausou por um instante.` };
  } else if (hostStatus !== 'connected') {
    overlay = { title: 'O apresentador perdeu a conexão', text: 'Aguardando a reconexão.', spinner: true };
  } else if (snap.viewer.media === 'failed') {
    overlay = { title: 'Falha ao receber o vídeo', text: 'A conexão direta com o apresentador caiu.', action: { label: 'Tentar de novo', onClick: () => session.requestStream() } };
  } else if (!hasFrames) {
    overlay = { title: 'Conectando à transmissão', text: snap.viewer.media === 'reconnecting' ? 'Reconectando o vídeo.' : 'Em instantes a imagem aparece.', spinner: true };
  }

  const hostIdle = isHost && !h.sharing;
  const live = snap.stream.streaming;

  // Celular: o palco ocupa a largura toda; computador: cartão com contorno.
  const boxClass = fs
    ? 'relative h-full w-full bg-black'
    : `relative w-full overflow-hidden bg-black max-sm:-mx-3 max-sm:w-[calc(100%+1.5rem)] sm:rounded-2xl sm:border-2 sm:border-ink sm:shadow-hard max-sm:border-y-2 max-sm:border-ink ${
        hostIdle ? 'min-h-[22rem]' : 'aspect-video max-h-[72dvh] landscape:max-sm:max-h-[calc(100dvh-5rem)]'
      }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-brand-600 px-2.5 py-0.5 text-xs font-extrabold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Ao vivo
          </span>
        )}
        <span className="font-bold">{isHost ? 'Você é o apresentador' : `Apresentador: ${hostName}`}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-semibold text-zinc-700">
          <Icon name="users" size={16} />
          {viewerCount} {viewerCount === 1 ? 'espectador' : 'espectadores'}
        </span>
      </div>

      <div ref={containerRef} className={boxClass}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          disablePictureInPicture={!pipOk}
          onPlaying={() => setHasFrames(true)}
          onLoadedData={() => setHasFrames(true)}
          className={`h-full w-full bg-black object-contain ${mirror && h.source === 'camera' ? '-scale-x-100' : ''} ${hostIdle ? 'invisible absolute' : ''}`}
        />

        {camStream && !hostIdle && (
          <button
            type="button"
            onClick={() => setBubbleBig((b) => !b)}
            aria-label={bubbleBig ? 'Diminuir a câmera' : 'Ampliar a câmera'}
            className={`absolute right-2 top-2 overflow-hidden rounded-xl border-2 border-white bg-black shadow-lg sm:right-3 sm:top-3 ${
              bubbleBig ? 'w-[48%]' : 'w-[28%] min-w-[96px] max-w-[300px]'
            }`}
          >
            <video ref={camRef} autoPlay muted playsInline className={`aspect-video w-full object-cover ${mirror ? '-scale-x-100' : ''}`} />
          </button>
        )}

        {hostIdle && (
          <div className="absolute inset-0 overflow-auto bg-black text-white">
            <HostStart session={session} snap={snap} />
          </div>
        )}

        {overlay && !hostIdle && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-white">
            <div className="max-w-sm">
              {overlay.spinner && <span className="mx-auto mb-3 block h-9 w-9 animate-spin rounded-full border-4 border-white/25 border-t-white" aria-hidden="true" />}
              <p className="text-lg font-black">{overlay.title}</p>
              {overlay.text && <p className="mt-1 text-sm font-medium text-white/80">{overlay.text}</p>}
              {overlay.action && (
                <button type="button" className="btn btn-primary mt-4" onClick={overlay.action.onClick}>
                  <Icon name="refresh" size={16} />
                  {overlay.action.label}
                </button>
              )}
            </div>
          </div>
        )}

        {!isHost && blocked && !overlay && (
          <button type="button" onClick={toggleMute} className="btn btn-primary absolute left-1/2 top-3 -translate-x-1/2">
            <Icon name="volume" size={16} />
            Ativar o som
          </button>
        )}

        {!hostIdle && (
          <div className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent p-2 pt-8 text-white transition-opacity ${fs && idle ? 'opacity-0' : 'opacity-100'}`}>
            {!isHost && (
              <>
                <button type="button" className="ctl" onClick={toggleMute} aria-label={muted ? 'Ativar o som' : 'Silenciar'}>
                  <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  className="hidden w-24 sm:block"
                  aria-label="Volume"
                />
              </>
            )}
            {isHost && <span className="px-2 text-xs font-bold">Prévia da sua transmissão (sem áudio)</span>}
            <span className="flex-1" />
            {!isHost && <LinkBadge session={session} open={statsOpen} onToggle={() => setStatsOpen((o) => !o)} />}
            {pipOk && (
              <button type="button" className="ctl" onClick={togglePip} aria-label="Picture-in-Picture">
                <Icon name="pip" />
              </button>
            )}
            <button type="button" className="ctl" onClick={toggleFullscreen} aria-label={fs ? 'Sair da tela cheia' : 'Tela cheia'}>
              <Icon name={fs ? 'minimize' : 'maximize'} />
            </button>
          </div>
        )}

        {!isHost && statsOpen && <StatsPanel session={session} />}
      </div>
    </div>
  );
}

export default memo(Stage);
