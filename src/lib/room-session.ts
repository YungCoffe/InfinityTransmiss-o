/**
 * Controlador da sala no cliente: Socket.IO + WebRTC fora do React.
 * Os componentes só assinam o snapshot (useSyncExternalStore) e chamam métodos como startSharing().
 */
import type { Socket } from 'socket.io-client';
import { connectSocket, request } from './socket';
import {
  HostBroadcaster,
  ViewerReceiver,
  QUALITY_PROFILES,
  type ContentMode,
  type HostStats,
  type MediaState,
  type QualityKey,
  type SignalData,
  type ViewerStats,
} from './webrtc';
import type { AckFail, InfoOk, JoinOk, Participant, Role, RoomInfo, StreamState } from './types';
import { getClientId, lsGet, lsSet, randomId, supportsDisplayCapture, supportsWebRTC } from './utils';

export type Phase = 'init' | 'checking' | 'ready' | 'joining' | 'joined' | 'error';
export type FatalKind = 'not-found' | 'closed' | 'full' | 'unsupported' | 'offline' | 'connection' | 'replaced' | 'rate-limited';
export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type ShareError = 'permission' | 'unsupported' | 'capture' | null;
export type JoinError = 'wrong-password' | 'password-required' | 'connection' | null;

export interface HostState {
  sharing: boolean;
  paused: boolean;
  shareError: ShareError;
  quality: QualityKey;
  mode: ContentMode;
  hasAudio: boolean;
  localStream: MediaStream | null;
  stats: HostStats | null;
}
export interface ViewerState {
  media: MediaState;
  mediaStream: MediaStream | null;
  stats: ViewerStats | null;
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

const initialHost = (): HostState => ({
  sharing: false,
  paused: false,
  shareError: null,
  quality: '1080p',
  mode: 'detail',
  hasAudio: false,
  localStream: null,
  stats: null,
});
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
  stream: { streaming: false, paused: false },
  host: initialHost(),
  viewer: { media: 'waiting', mediaStream: null, stats: null },
});

const isQualityKey = (v: string | null): v is QualityKey => !!v && v in QUALITY_PROFILES;

function classifyCaptureError(e: unknown): ShareError {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'AbortError') return 'permission';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'capture';
}

export class RoomSession {
  private snap: Snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private runId = 0;
  private socket: Socket | null = null;
  private bound: Array<[string, (...args: any[]) => void]> = [];
  private broadcaster: HostBroadcaster | null = null;
  private receiver: ViewerReceiver | null = null;
  private joinParams: Record<string, unknown> | null = null;
  private hostKey: string | null = null;
  private clientId = '';
  private epoch = '';
  private iceServers: RTCIceServer[] = [];
  private captured: MediaStream | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public readonly code: string) {}

  /* ------------------------------------------------ store para o React */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

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

  /* --------------------------------------------------------- ciclo de vida */
  async start() {
    const run = ++this.runId;
    this.snap = { ...initialSnapshot(), phase: 'checking' };
    this.listeners.forEach((l) => l());

    if (!supportsWebRTC()) return this.fatal('unsupported');

    this.clientId = getClientId();
    this.epoch = randomId(8);
    this.hostKey = lsGet(`itx:host:${this.code}`);
    const q = lsGet('itx:quality');
    const m = lsGet('itx:mode');
    this.setHost({ quality: isQualityKey(q) ? q : '1080p', mode: m === 'motion' ? 'motion' : 'detail' });

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
    on('viewer:joined', (v: { clientId: string; epoch: string }) => this.broadcaster?.viewerJoined(v.clientId, v.epoch));
    on('viewer:left', (v: { clientId: string }) => this.broadcaster?.viewerLeft(v.clientId));
    on('viewer:request', (v: { clientId: string; epoch: string }) => this.broadcaster?.viewerRequest(v.clientId, v.epoch));
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
    this.set({
      phase: 'joined',
      role: res.role,
      you: res.you,
      participants: res.participants,
      stream: res.stream,
      info: res.room,
      link: 'connected',
    });
    if (res.role === 'host') {
      this.ensureBroadcaster();
      for (const v of res.viewers ?? []) this.broadcaster?.viewerJoined(v.clientId, v.epoch);
      this.emitStreamState(); // informa ao servidor o estado real (pode ter mudado durante uma queda)
    } else {
      this.ensureReceiver();
      this.setViewer({ media: res.stream.streaming && this.snap.viewer.media === 'waiting' ? 'connecting' : this.snap.viewer.media });
    }
  }

  private onStreamState(s: StreamState) {
    this.set({ stream: s });
    if (this.snap.role !== 'viewer') return;
    if (!s.streaming) {
      this.receiver?.reset();
      this.setViewer({ media: 'waiting', mediaStream: null, stats: null });
    } else if (this.snap.viewer.media === 'waiting') {
      this.setViewer({ media: 'connecting' });
    }
  }

  private ensureBroadcaster() {
    if (this.broadcaster) return;
    const b = new HostBroadcaster({
      iceServers: this.iceServers,
      send: (to, data) => this.socket?.emit('signal', { to, data }),
      onStats: (stats) => this.setHost({ stats }),
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
      onState: (media) => this.setViewer({ media }),
      onStats: (stats) => this.setViewer({ stats }),
      onRequestStream: () => this.socket?.emit('viewer:request-stream'),
    });
  }

  private teardownMedia() {
    this.captured?.getTracks().forEach((t) => t.stop());
    this.captured = null;
    this.broadcaster?.destroy();
    this.broadcaster = null;
    this.receiver?.close();
    this.receiver = null;
    const { quality, mode } = this.snap.host;
    this.set({
      host: { ...initialHost(), quality, mode },
      viewer: { media: 'waiting', mediaStream: null, stats: null },
    });
  }

  private emitStreamState() {
    const { sharing, paused } = this.snap.host;
    this.socket?.emit('stream:state', { streaming: sharing, paused: sharing && paused });
  }

  /* --------------------------------------------------- ações do apresentador */
  private capture(): Promise<MediaStream> {
    const prof = QUALITY_PROFILES[this.snap.host.quality];
    // Navegadores ignoram opções que não conhecem; o que for suportado melhora a captura de áudio e a troca de fonte.
    const constraints: any = {
      video: { width: { ideal: prof.width }, height: { ideal: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
    };
    return navigator.mediaDevices.getDisplayMedia(constraints);
  }

  private onTrackEnded = (e: Event) => {
    // O usuário clicou em "Parar compartilhamento" na barra do navegador.
    if (this.captured?.getVideoTracks()[0] === e.target) this.stopSharing();
  };

  private attach(stream: MediaStream) {
    const old = this.captured;
    old?.getVideoTracks()[0]?.removeEventListener('ended', this.onTrackEnded);
    stream.getVideoTracks()[0]?.addEventListener('ended', this.onTrackEnded);
    this.captured = stream;
    if (this.broadcaster?.streaming) this.broadcaster.replaceSource(stream);
    else this.broadcaster?.start(stream);
    if (this.snap.host.paused) this.broadcaster?.setPaused(true);
    old?.getTracks().forEach((t) => t.stop());
    this.setHost({ sharing: true, hasAudio: stream.getAudioTracks().length > 0, localStream: stream, shareError: null });
    this.emitStreamState();
  }

  async startSharing() {
    if (this.snap.role !== 'host') return;
    this.setHost({ shareError: null });
    if (!supportsDisplayCapture()) return this.setHost({ shareError: 'unsupported' });
    try {
      this.attach(await this.capture());
    } catch (e) {
      this.setHost({ shareError: classifyCaptureError(e) });
    }
  }

  /** Troca tela/janela/aba sem sair da sala nem renegociar a conexão com os espectadores. */
  async switchSource() {
    if (!this.snap.host.sharing || !supportsDisplayCapture()) return;
    try {
      this.attach(await this.capture());
    } catch (e) {
      if (classifyCaptureError(e) !== 'permission') this.setHost({ shareError: 'capture' });
    }
  }

  stopSharing() {
    this.captured?.getVideoTracks()[0]?.removeEventListener('ended', this.onTrackEnded);
    this.broadcaster?.stop();
    this.captured?.getTracks().forEach((t) => t.stop());
    this.captured = null;
    this.setHost({ sharing: false, paused: false, hasAudio: false, localStream: null, stats: null });
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
