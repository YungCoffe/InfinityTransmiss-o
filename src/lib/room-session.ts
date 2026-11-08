/**
 * Controlador da sala no cliente: Socket.IO + WebRTC + captura (tela, câmera e microfone) fora do React.
 * Os componentes assinam o snapshot (useSyncExternalStore) e chamam métodos como startScreen() ou toggleMic().
 * As métricas (stats) ficam em um store separado para não re-renderizar a sala inteira a cada 1-2 segundos.
 */
import type { Socket } from 'socket.io-client';
import { connectSocket, request } from './socket';
import { Capture, listCameras, openCamera } from './capture';
import {
  BUBBLE,
  HostBroadcaster,
  ViewerReceiver,
  QUALITY_PROFILES,
  shallowEqual,
  type ContentMode,
  type HostSource,
  type HostStats,
  type MediaState,
  type QualityKey,
  type SignalData,
  type ViewerStats,
} from './webrtc';
import type { AckFail, InfoOk, JoinOk, Participant, Role, RoomInfo, StreamState } from './types';
import { displayMaxHeight, getClientId, isMobileDevice, lsGet, lsSet, randomId, supportsCamera, supportsDisplayCapture, supportsWebRTC } from './utils';

export type Phase = 'init' | 'checking' | 'ready' | 'joining' | 'joined' | 'error';
export type FatalKind = 'not-found' | 'closed' | 'full' | 'unsupported' | 'offline' | 'connection' | 'replaced' | 'rate-limited';
export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type ShareError =
  | 'permission'
  | 'unsupported'
  | 'capture'
  | 'camera-denied'
  | 'camera-missing'
  | 'camera-busy'
  | 'mic-denied'
  | 'mic-missing'
  | null;
export type JoinError = 'wrong-password' | 'password-required' | 'connection' | null;

export interface HostState {
  sharing: boolean;
  paused: boolean;
  busy: boolean;
  source: HostSource | null;
  cameraOn: boolean; // câmera sobre a tela (balão)
  micOn: boolean;
  micWanted: boolean; // preferência: liga o microfone ao começar a transmitir
  voiceFilter: boolean; // eco, ruído e ganho automático
  hasSystemAudio: boolean;
  facing: 'user' | 'environment' | null;
  shareError: ShareError;
  quality: QualityKey;
  mode: ContentMode;
  localStream: MediaStream | null; // prévia do vídeo principal
  localCamera: MediaStream | null; // prévia do balão
}
export interface ViewerState {
  media: MediaState;
  mediaStream: MediaStream | null;
  cameraStream: MediaStream | null;
}
export interface Snapshot {
  phase: Phase;
  fatal: FatalKind | null;
  closedReason: string | null;
  joinError: JoinError;
  link: LinkState;
  info: RoomInfo | null;
  role: Role | null;
  you: { clientId: string; name: string } | null;
  participants: Participant[];
  stream: StreamState;
  host: HostState;
  viewer: ViewerState;
}

const defaultQuality = (): QualityKey => (isMobileDevice() ? '1080p' : 'max');

const initialHost = (): HostState => ({
  sharing: false,
  paused: false,
  busy: false,
  source: null,
  cameraOn: false,
  micOn: false,
  micWanted: false,
  voiceFilter: true,
  hasSystemAudio: false,
  facing: null,
  shareError: null,
  quality: defaultQuality(),
  mode: 'detail',
  localStream: null,
  localCamera: null,
});
const initialViewer = (): ViewerState => ({ media: 'waiting', mediaStream: null, cameraStream: null });
const initialStream = (): StreamState => ({ streaming: false, paused: false, source: 'screen', camera: false });
const initialSnapshot = (): Snapshot => ({
  phase: 'init',
  fatal: null,
  closedReason: null,
  joinError: null,
  link: 'connecting',
  info: null,
  role: null,
  you: null,
  participants: [],
  stream: initialStream(),
  host: initialHost(),
  viewer: initialViewer(),
});

const isQualityKey = (v: string | null): v is QualityKey => !!v && v in QUALITY_PROFILES;

function classify(e: unknown, kind: 'screen' | 'camera' | 'mic'): ShareError {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotSupportedError') return 'unsupported';
  if (kind === 'screen') return name === 'NotAllowedError' || name === 'SecurityError' || name === 'AbortError' ? 'permission' : 'capture';
  if (kind === 'camera') {
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'camera-denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'camera-missing';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'camera-busy';
    return 'capture';
  }
  return name === 'NotFoundError' ? 'mic-missing' : 'mic-denied';
}

const unsupported = () => Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
const facingOf = (s: MediaStream | null): 'user' | 'environment' | null => {
  const f = s?.getVideoTracks()[0]?.getSettings().facingMode;
  return f === 'user' || f === 'environment' ? f : null;
};

export class RoomSession {
  private snap: Snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private stats: { host: HostStats | null; viewer: ViewerStats | null } = { host: null, viewer: null };
  private statsListeners = new Set<() => void>();
  private runId = 0;
  private socket: Socket | null = null;
  private bound: Array<[string, (...args: any[]) => void]> = [];
  private broadcaster: HostBroadcaster | null = null;
  private receiver: ViewerReceiver | null = null;
  private capture = new Capture();
  private screen: MediaStream | null = null; // getDisplayMedia
  private cam: MediaStream | null = null; // câmera (principal ou balão)
  private joinParams: Record<string, unknown> | null = null;
  private hostKey: string | null = null;
  private clientId = '';
  private epoch = '';
  private iceServers: RTCIceServer[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public readonly code: string) {}

  /* ------------------------------------------------ stores para o React */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  subscribeStats = (fn: () => void) => {
    this.statsListeners.add(fn);
    return () => {
      this.statsListeners.delete(fn);
    };
  };
  getHostStats = () => this.stats.host;
  getViewerStats = () => this.stats.viewer;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }
  private setHost(patch: Partial<HostState>) {
    this.set({ host: { ...this.snap.host, ...patch } });
  }
  private setViewer(patch: Partial<ViewerState>) {
    this.set({ viewer: { ...this.snap.viewer, ...patch } });
  }
  private setStats(patch: Partial<{ host: HostStats | null; viewer: ViewerStats | null }>) {
    const next = { ...this.stats, ...patch };
    if (shallowEqual(next.host, this.stats.host) && shallowEqual(next.viewer, this.stats.viewer)) return;
    this.stats = {
      host: shallowEqual(next.host, this.stats.host) ? this.stats.host : next.host,
      viewer: shallowEqual(next.viewer, this.stats.viewer) ? this.stats.viewer : next.viewer,
    };
    this.statsListeners.forEach((l) => l());
  }

  /* --------------------------------------------------------- ciclo de vida */
  async start() {
    const run = ++this.runId;
    this.snap = { ...initialSnapshot(), phase: 'checking' };
    this.stats = { host: null, viewer: null };
    this.listeners.forEach((l) => l());

    if (!supportsWebRTC()) return this.fatal('unsupported');

    this.clientId = getClientId();
    this.epoch = randomId(8);
    this.hostKey = lsGet(`itx:host:${this.code}`);
    const q = lsGet('itx:quality');
    this.setHost({
      quality: isQualityKey(q) ? q : defaultQuality(),
      mode: lsGet('itx:mode') === 'motion' ? 'motion' : 'detail',
      micWanted: lsGet('itx:mic') === 'on',
      voiceFilter: lsGet('itx:voice') !== 'off',
    });

    let socket: Socket;
    try {
      socket = await connectSocket();
    } catch {
      if (run === this.runId) this.fatal('offline');
      return;
    }
    if (run !== this.runId) return;
    this.bind(socket);

    let res: InfoOk | AckFail;
    try {
      res = await request<InfoOk | AckFail>(socket, 'room:info', { code: this.code, hostKey: this.hostKey ?? undefined });
    } catch {
      if (run === this.runId) this.fatal('connection');
      return;
    }
    if (run !== this.runId) return;
    if (!res.ok) return this.failFrom(res.error);

    this.set({ info: res.room, phase: 'ready', link: 'connected' });
    if (res.room.isHost) await this.join({ name: lsGet('itx:name') || res.room.hostName });
  }

  retry() {
    this.destroy();
    void this.start();
  }

  destroy() {
    this.runId++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket && this.joinParams) this.socket.emit('room:leave');
    this.unbind();
    this.joinParams = null;
    this.socket = null;
    this.teardownMedia();
  }

  /* ---------------------------------------------------------------- socket */
  private bind(socket: Socket) {
    this.unbind();
    this.socket = socket;
    const on = (ev: string, fn: (...a: any[]) => void) => {
      socket.on(ev, fn);
      this.bound.push([ev, fn]);
    };
    on('connect', () => {
      this.set({ link: 'connected' });
      if (this.joinParams) void this.rejoin();
    });
    on('disconnect', (reason: string) => {
      if (reason === 'io client disconnect') return;
      this.set({ link: reason === 'io server disconnect' ? 'disconnected' : 'reconnecting' });
      if (reason === 'io server disconnect') {
        // O servidor encerrou a sessão: o Socket.IO não reconecta sozinho nesse caso.
        this.reconnectTimer = setTimeout(() => socket.connect(), 2000);
      }
    });
    on('connect_error', () => {
      if (this.joinParams) this.set({ link: 'reconnecting' });
    });
    on('participants', (list: Participant[]) => this.set({ participants: list }));
    on('stream:state', (s: StreamState) => this.onStreamState(s));
    on('signal', (m: { from: string; data: SignalData }) => {
      if (this.snap.role === 'host') void this.broadcaster?.handleSignal(m.from, m.data);
      else void this.receiver?.handleSignal(m.data);
    });
    on('viewer:joined', (v: { clientId: string; epoch: string; maxHeight?: number | null }) => this.broadcaster?.viewerJoined(v.clientId, v.epoch, v.maxHeight));
    on('viewer:left', (v: { clientId: string }) => this.broadcaster?.viewerLeft(v.clientId));
    on('viewer:request', (v: { clientId: string; epoch: string; maxHeight?: number | null }) => this.broadcaster?.viewerRequest(v.clientId, v.epoch, v.maxHeight));
    on('room:closed', (m: { reason?: string } | undefined) => {
      this.joinParams = null;
      this.teardownMedia();
      this.set({ phase: 'error', fatal: 'closed', closedReason: m?.reason ?? null });
    });
    on('session:replaced', () => {
      this.joinParams = null;
      this.fatal('replaced');
    });
  }

  private unbind() {
    if (this.socket) for (const [ev, fn] of this.bound) this.socket.off(ev, fn);
    this.bound = [];
  }

  private fatal(kind: FatalKind) {
    this.teardownMedia();
    this.set({ phase: 'error', fatal: kind });
  }

  private failFrom(code: string) {
    switch (code) {
      case 'NOT_FOUND':
        return this.fatal('not-found');
      case 'CLOSED':
        return this.fatal('closed');
      case 'FULL':
        return this.fatal('full');
      case 'RATE_LIMITED':
        return this.fatal('rate-limited');
      default:
        return this.fatal('connection');
    }
  }

  /* ------------------------------------------------------------------ entrar */
  async join(p: { name: string; password?: string }) {
    const socket = this.socket;
    if (!socket) return;
    const run = this.runId;
    const name = p.name.trim().slice(0, 24) || 'Visitante';
    this.set({ phase: 'joining', joinError: null });
    const params = {
      code: this.code,
      clientId: this.clientId,
      epoch: this.epoch,
      name,
      password: p.password || undefined,
      hostKey: this.hostKey ?? undefined,
      maxHeight: displayMaxHeight(), // o host não envia mais pixels do que esta tela mostra
    };
    let res: JoinOk | AckFail;
    try {
      res = await request<JoinOk | AckFail>(socket, 'room:join', params);
    } catch {
      if (run === this.runId) this.set({ phase: 'ready', joinError: 'connection' });
      return;
    }
    if (run !== this.runId) return;
    if (!res.ok) {
      if (res.error === 'WRONG_PASSWORD') return this.set({ phase: 'ready', joinError: 'wrong-password' });
      if (res.error === 'PASSWORD_REQUIRED') return this.set({ phase: 'ready', joinError: 'password-required' });
      return this.failFrom(res.error);
    }
    lsSet('itx:name', name);
    this.joinParams = params;
    this.onJoined(res);
  }

  private async rejoin() {
    const socket = this.socket;
    if (!socket || !this.joinParams) return;
    const run = this.runId;
    try {
      const res = await request<JoinOk | AckFail>(socket, 'room:join', this.joinParams);
      if (run !== this.runId) return;
      if (res.ok) this.onJoined(res);
      else this.failFrom(res.error);
    } catch {
      /* o próximo "connect" tenta de novo */
    }
  }

  private onJoined(res: JoinOk) {
    this.iceServers = res.iceServers;
    this.set({ phase: 'joined', role: res.role, you: res.you, participants: res.participants, stream: res.stream, info: res.room, link: 'connected' });
    if (res.role === 'host') {
      this.ensureBroadcaster();
      for (const v of res.viewers ?? []) this.broadcaster?.viewerJoined(v.clientId, v.epoch, v.maxHeight);
      this.emitStreamState(); // informa ao servidor o estado real (pode ter mudado durante uma queda)
    } else {
      this.ensureReceiver();
      if (res.stream.streaming && this.snap.viewer.media === 'waiting') this.setViewer({ media: 'connecting' });
    }
  }

  private onStreamState(s: StreamState) {
    this.set({ stream: s });
    if (this.snap.role !== 'viewer') return;
    if (!s.streaming) {
      this.receiver?.reset();
      this.setViewer(initialViewer());
    } else if (this.snap.viewer.media === 'waiting') {
      this.setViewer({ media: 'connecting' });
    }
  }

  private ensureBroadcaster() {
    if (this.broadcaster) return;
    const b = new HostBroadcaster({
      iceServers: this.iceServers,
      send: (to, data) => this.socket?.emit('signal', { to, data }),
      onStats: (host) => this.setStats({ host }),
    });
    b.setQuality(this.snap.host.quality);
    b.setMode(this.snap.host.mode);
    this.broadcaster = b;
  }

  private ensureReceiver() {
    if (this.receiver) return;
    this.receiver = new ViewerReceiver({
      iceServers: this.iceServers,
      send: (data) => this.socket?.emit('signal', { to: 'host', data }),
      onStream: (mediaStream) => this.setViewer({ mediaStream }),
      onCamera: (cameraStream) => this.setViewer({ cameraStream }),
      onState: (media) => this.setViewer({ media }),
      onStats: (viewer) => this.setStats({ viewer }),
      onRequestStream: () => this.socket?.emit('viewer:request-stream'),
    });
  }

  private teardownMedia() {
    this.releaseScreen();
    this.stopCam();
    this.capture.stop();
    this.broadcaster?.destroy();
    this.broadcaster = null;
    this.receiver?.close();
    this.receiver = null;
    const { quality, mode, micWanted, voiceFilter } = this.snap.host;
    this.stats = { host: null, viewer: null };
    this.statsListeners.forEach((l) => l());
    this.set({ host: { ...initialHost(), quality, mode, micWanted, voiceFilter }, viewer: initialViewer() });
  }

  private emitStreamState() {
    const h = this.snap.host;
    this.socket?.emit('stream:state', {
      streaming: h.sharing,
      paused: h.sharing && h.paused,
      source: h.source ?? 'screen',
      camera: h.sharing && h.cameraOn,
    });
  }

  /* --------------------------------------------------- captura (apresentador) */
  private getScreen(): Promise<MediaStream> {
    const prof = QUALITY_PROFILES[this.snap.host.quality];
    // Navegadores ignoram opções que não conhecem; o que for suportado melhora a captura de áudio e a troca de fonte.
    const constraints: any = {
      video: { width: { ideal: prof.width }, height: { ideal: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
    };
    return navigator.mediaDevices.getDisplayMedia(constraints);
  }

  private mainCameraOptions(deviceId?: string, facingMode?: 'user' | 'environment') {
    const prof = QUALITY_PROFILES[this.snap.host.quality];
    return { width: prof.width, height: prof.height, fps: prof.fps, deviceId, facingMode: facingMode ?? (isMobileDevice() ? ('user' as const) : undefined) };
  }

  private onScreenEnded = (e: Event) => {
    // O usuário clicou em "Parar compartilhamento" na barra do navegador.
    if (this.screen?.getVideoTracks()[0] === e.target) this.stopSharing();
  };

  private onCamEnded = (e: Event) => {
    if (this.cam?.getVideoTracks()[0] !== e.target) return;
    if (this.snap.host.source === 'camera') return this.stopSharing();
    this.stopCam();
    this.setHost({ cameraOn: false, localCamera: null });
    this.syncTracks();
    this.emitStreamState();
  };

  private adoptScreen(stream: MediaStream) {
    const old = this.screen;
    old?.getVideoTracks()[0]?.removeEventListener('ended', this.onScreenEnded);
    stream.getVideoTracks()[0]?.addEventListener('ended', this.onScreenEnded);
    this.screen = stream;
    this.capture.setSystemAudio(stream);
    old?.getTracks().forEach((t) => t.stop());
  }

  private releaseScreen() {
    this.screen?.getVideoTracks()[0]?.removeEventListener('ended', this.onScreenEnded);
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.capture.setSystemAudio(null);
  }

  private adoptCam(stream: MediaStream) {
    this.cam = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', this.onCamEnded);
    this.setHost({ facing: facingOf(stream) });
  }

  private stopCam() {
    this.cam?.getVideoTracks()[0]?.removeEventListener('ended', this.onCamEnded);
    this.cam?.getTracks().forEach((t) => t.stop());
    this.cam = null;
  }

  private mainTrack(): MediaStreamTrack | null {
    return (this.snap.host.source === 'camera' ? this.cam : this.screen)?.getVideoTracks()[0] ?? null;
  }
  private bubbleTrack(): MediaStreamTrack | null {
    const h = this.snap.host;
    return h.source === 'screen' && h.cameraOn ? this.cam?.getVideoTracks()[0] ?? null : null;
  }

  /** Envia as faixas atuais (vídeo, áudio mixado e balão) ao WebRTC e atualiza as prévias. */
  private syncTracks() {
    const video = this.mainTrack();
    const b = this.broadcaster;
    if (!video || !b) return;
    const camera = this.bubbleTrack();
    const tracks = { video, audio: this.capture.audioTrack(), camera, source: this.snap.host.source ?? 'screen' };
    if (b.streaming) b.update(tracks);
    else b.start(tracks);
    if (this.snap.host.paused) b.setPaused(true);
    this.setHost({
      localStream: new MediaStream([video]),
      localCamera: camera ? new MediaStream([camera]) : null,
      hasSystemAudio: this.capture.hasSystemAudio,
    });
  }

  /** Começa (ou troca) a fonte principal: tela ou câmera. Chamado direto de um clique. */
  private async beginSource(kind: HostSource) {
    const h0 = this.snap.host;
    if (this.snap.role !== 'host' || h0.busy) return;
    if (h0.sharing && kind === 'camera' && h0.source === 'camera') return;
    const wasSharing = h0.sharing;
    this.setHost({ busy: true, shareError: null });
    this.capture.prepareAudio(); // dentro do gesto do clique: iOS e Safari exigem isso para liberar o áudio
    try {
      if (kind === 'screen') {
        if (!supportsDisplayCapture()) throw unsupported();
        const stream = await this.getScreen();
        this.stopCam(); // a câmera principal sai; o balão pode ser ligado de novo
        this.adoptScreen(stream);
        this.setHost({ source: 'screen', cameraOn: false, localCamera: null, facing: null });
      } else {
        if (!supportsCamera()) throw unsupported();
        this.stopCam(); // celulares só abrem uma câmera por vez
        const stream = await openCamera(this.mainCameraOptions());
        this.releaseScreen();
        this.adoptCam(stream);
        this.setHost({ source: 'camera', cameraOn: false, localCamera: null });
      }
    } catch (e) {
      const err = classify(e, kind);
      // Cancelar o seletor de tela durante a transmissão não é erro: continua com a fonte atual.
      if (!(wasSharing && err === 'permission')) this.setHost({ shareError: err });
      if (wasSharing && !this.mainTrack()) this.stopSharing();
      this.setHost({ busy: false });
      return;
    }

    if (this.snap.host.micWanted && !this.capture.micActive) {
      try {
        await this.capture.enableMic(this.snap.host.voiceFilter);
        this.setHost({ micOn: true });
      } catch (e) {
        this.setHost({ micOn: false, shareError: classify(e, 'mic') }); // a transmissão segue, sem microfone
      }
    }
    this.setHost({ sharing: true, paused: wasSharing ? this.snap.host.paused : false, busy: false });
    this.syncTracks();
    this.emitStreamState();
  }

  startScreen() {
    return this.beginSource('screen');
  }
  startCamera() {
    return this.beginSource('camera');
  }

  /** Escolher outra tela, janela ou aba (sem sair da sala nem renegociar). */
  switchScreen() {
    return this.beginSource('screen');
  }

  /** Alterna entre as câmeras do aparelho (frontal/traseira no celular). */
  async switchCamera() {
    const h = this.snap.host;
    const old = this.cam;
    if (!old || h.busy) return;
    const settings = old.getVideoTracks()[0]?.getSettings();
    const cams = await listCameras();
    const isMain = h.source === 'camera';
    const prof = QUALITY_PROFILES[h.quality];
    const size = isMain ? { width: prof.width, height: prof.height, fps: prof.fps } : { width: BUBBLE.width, height: BUBBLE.height, fps: BUBBLE.fps };
    let nextId: string | undefined;
    if (cams.length > 1) nextId = cams[(Math.max(0, cams.findIndex((c) => c.id === settings?.deviceId)) + 1) % cams.length].id;
    const flip = settings?.facingMode === 'environment' ? 'user' : 'environment';

    this.setHost({ busy: true, shareError: null });
    this.stopCam(); // libera a câmera atual antes de abrir a próxima
    try {
      this.adoptCam(await openCamera({ ...size, deviceId: nextId, facingMode: nextId ? undefined : flip }));
    } catch (e) {
      try {
        this.adoptCam(await openCamera({ ...size, deviceId: settings?.deviceId }));
      } catch {
        /* sem câmera */
      }
      this.setHost({ shareError: classify(e, 'camera') });
    }
    if (!this.cam) {
      if (isMain) {
        this.setHost({ busy: false });
        return this.stopSharing();
      }
      this.setHost({ cameraOn: false, localCamera: null });
    }
    this.setHost({ busy: false });
    this.syncTracks();
    this.emitStreamState();
  }

  /** Liga/desliga a câmera como balão sobre a tela compartilhada. */
  async toggleCameraBubble() {
    const h = this.snap.host;
    if (!h.sharing || h.source !== 'screen' || h.busy) return;
    if (h.cameraOn) {
      this.stopCam();
      this.setHost({ cameraOn: false, localCamera: null });
    } else {
      if (!supportsCamera()) return this.setHost({ shareError: 'unsupported' });
      this.setHost({ busy: true, shareError: null });
      try {
        this.adoptCam(await openCamera({ width: BUBBLE.width, height: BUBBLE.height, fps: BUBBLE.fps, facingMode: 'user' }));
        this.setHost({ cameraOn: true });
      } catch (e) {
        this.setHost({ shareError: classify(e, 'camera') });
      }
      this.setHost({ busy: false });
    }
    this.syncTracks();
    this.emitStreamState();
  }

  async toggleMic() {
    const h = this.snap.host;
    const next = !(h.sharing ? h.micOn : h.micWanted);
    lsSet('itx:mic', next ? 'on' : 'off');
    if (!h.sharing) return this.setHost({ micWanted: next });
    this.setHost({ micWanted: next, shareError: null });
    if (!next) {
      this.capture.disableMic();
      return this.setHost({ micOn: false });
    }
    this.capture.prepareAudio();
    try {
      await this.capture.enableMic(h.voiceFilter);
      this.setHost({ micOn: true });
    } catch (e) {
      this.setHost({ micOn: false, micWanted: false, shareError: classify(e, 'mic') });
    }
  }

  async setVoiceFilter(on: boolean) {
    lsSet('itx:voice', on ? 'on' : 'off');
    this.setHost({ voiceFilter: on });
    if (this.snap.host.micOn) {
      try {
        await this.capture.enableMic(on);
      } catch (e) {
        this.setHost({ micOn: false, shareError: classify(e, 'mic') });
      }
    }
  }

  micLevel() {
    return this.capture.level();
  }

  stopSharing() {
    this.releaseScreen();
    this.stopCam();
    this.capture.stop();
    this.broadcaster?.stop();
    this.setHost({
      sharing: false,
      paused: false,
      busy: false,
      source: null,
      cameraOn: false,
      micOn: false,
      hasSystemAudio: false,
      facing: null,
      localStream: null,
      localCamera: null,
    });
    this.emitStreamState();
  }

  togglePause() {
    if (!this.snap.host.sharing) return;
    const paused = !this.snap.host.paused;
    this.broadcaster?.setPaused(paused);
    this.setHost({ paused });
    this.emitStreamState();
  }

  setQuality(key: QualityKey) {
    lsSet('itx:quality', key);
    this.setHost({ quality: key });
    this.broadcaster?.setQuality(key);
  }

  setMode(mode: ContentMode) {
    lsSet('itx:mode', mode);
    this.setHost({ mode });
    this.broadcaster?.setMode(mode);
  }

  closeRoom() {
    this.stopSharing();
    this.socket?.emit('room:close', {});
  }

  /** Espectador: pede ao apresentador uma nova conexão de vídeo. */
  requestStream() {
    this.setViewer({ media: 'connecting' });
    this.socket?.emit('viewer:request-stream');
  }
}
