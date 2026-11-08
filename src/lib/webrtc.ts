/**
 * WebRTC nativo em topologia de estrela:
 *   HostBroadcaster  → um RTCPeerConnection por espectador (o host sempre envia a oferta)
 *   ViewerReceiver   → um RTCPeerConnection que apenas responde e recebe
 * Para evoluir para um SFU (LiveKit, mediasoup, Janus) basta trocar estas duas classes: o restante do app
 * só conhece start/stop/replaceSource (host) e onStream/onState/onStats (espectador).
 */
import { randomId } from './utils';

export type SignalData = { sid: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export type QualityKey = '1440p' | '1080p60' | '1080p' | '720p' | '480p';
export type ContentMode = 'detail' | 'motion';
export type MediaState = 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
export type LinkQuality = 'excellent' | 'good' | 'fair' | 'poor';

export interface QualityProfile {
  key: QualityKey;
  label: string;
  width: number;
  height: number;
  fps: number;
  maxBitrate: number;
  minBitrate: number;
}

export const QUALITY_PROFILES: Record<QualityKey, QualityProfile> = {
  '1440p': { key: '1440p', label: '1440p, 30 fps (máxima)', width: 2560, height: 1440, fps: 30, maxBitrate: 10_000_000, minBitrate: 500_000 },
  '1080p60': { key: '1080p60', label: '1080p, 60 fps (fluidez)', width: 1920, height: 1080, fps: 60, maxBitrate: 9_000_000, minBitrate: 500_000 },
  '1080p': { key: '1080p', label: '1080p, 30 fps (recomendada)', width: 1920, height: 1080, fps: 30, maxBitrate: 6_000_000, minBitrate: 400_000 },
  '720p': { key: '720p', label: '720p, 30 fps (equilibrada)', width: 1280, height: 720, fps: 30, maxBitrate: 3_000_000, minBitrate: 300_000 },
  '480p': { key: '480p', label: '480p, 30 fps (economia)', width: 854, height: 480, fps: 30, maxBitrate: 1_200_000, minBitrate: 200_000 },
};

export interface HostStats {
  viewers: number;
  connected: number;
  totalKbps: number;
  rttMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  reduced: boolean;
}

export interface ViewerStats {
  quality: LinkQuality;
  kbps: number;
  fps: number;
  width: number;
  height: number;
  lossPct: number;
  rttMs: number | null;
  jitterMs: number;
  latencyMs: number | null;
}

/** Prefere VP9 (texto nítido em bitrates menores), depois H.264, VP8 e AV1. O navegador negocia o que ambos suportam. */
function preferCodecs(tx: RTCRtpTransceiver) {
  try {
    const caps = (RTCRtpSender as any).getCapabilities?.('video');
    if (!caps || typeof (tx as any).setCodecPreferences !== 'function') return;
    const rank = (mime: string) => {
      const m = mime.toLowerCase();
      return m === 'video/vp9' ? 0 : m === 'video/h264' ? 1 : m === 'video/vp8' ? 2 : m === 'video/av1' ? 3 : 4;
    };
    const sorted = [...caps.codecs].sort((a: any, b: any) => rank(a.mimeType) - rank(b.mimeType));
    (tx as any).setCodecPreferences(sorted);
  } catch {
    /* mantém a ordem padrão */
  }
}

/* ------------------------------------------------------------------ HOST */

interface Peer {
  id: string;
  epoch: string;
  sid: string;
  pc: RTCPeerConnection;
  video: RTCRtpSender;
  audio: RTCRtpSender;
  pending: RTCIceCandidateInit[];
  remoteReady: boolean;
  level: number;
  stable: number;
  restarts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  audioTuned: boolean;
  lastBytes: number;
  lastTs: number;
  kbps: number;
  rtt: number | null;
  loss: number;
  limited: boolean;
  fw: number | null;
  fh: number | null;
  fps: number | null;
}

interface HostOptions {
  iceServers: RTCIceServer[];
  send: (to: string, data: SignalData) => void;
  onStats?: (stats: HostStats | null) => void;
}

export class HostBroadcaster {
  private peers = new Map<string, Peer>();
  private viewers = new Map<string, string>();
  private stream: MediaStream | null = null;
  private quality: QualityKey = '1080p';
  private mode: ContentMode = 'detail';
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(private opts: HostOptions) {}

  get streaming() {
    return this.stream !== null;
  }

  start(stream: MediaStream) {
    this.stream = stream;
    this.decorate(stream);
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 2000);
    for (const [id, epoch] of this.viewers) void this.connectViewer(id, epoch);
  }

  /** Troca a fonte compartilhada sem renegociar: só substitui as faixas nos remetentes existentes. */
  replaceSource(stream: MediaStream) {
    this.stream = stream;
    this.decorate(stream);
    const v = stream.getVideoTracks()[0] ?? null;
    const a = stream.getAudioTracks()[0] ?? null;
    for (const p of this.peers.values()) {
      void p.video.replaceTrack(v).catch(() => {});
      void p.audio.replaceTrack(a).catch(() => {});
      void this.applyParams(p);
    }
  }

  stop() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stream = null;
    this.paused = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.opts.onStats?.(null);
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.viewers.clear();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.stream?.getTracks().forEach((t) => (t.enabled = !paused));
  }

  setQuality(key: QualityKey) {
    this.quality = key;
    if (this.stream) this.decorate(this.stream);
    for (const p of this.peers.values()) void this.applyParams(p);
  }

  setMode(mode: ContentMode) {
    this.mode = mode;
    const v = this.stream?.getVideoTracks()[0];
    if (v) {
      try {
        v.contentHint = mode === 'detail' ? 'detail' : 'motion';
      } catch {
        /* ignora */
      }
    }
    for (const p of this.peers.values()) void this.applyParams(p);
  }

  viewerJoined(id: string, epoch: string) {
    this.viewers.set(id, epoch);
    if (this.stream) void this.connectViewer(id, epoch);
  }

  viewerLeft(id: string) {
    this.viewers.delete(id);
    this.closePeer(id);
    this.emit();
  }

  viewerRequest(id: string, epoch: string) {
    this.viewers.set(id, epoch);
    if (!this.stream) return;
    const p = this.peers.get(id);
    if (p && p.epoch === epoch) this.restartIce(p, true);
    else void this.connectViewer(id, epoch);
  }

  async handleSignal(from: string, data: SignalData) {
    const p = this.peers.get(from);
    if (!p || data.sid !== p.sid) return;
    try {
      if (data.description?.type === 'answer') {
        if (p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription(data.description);
        p.remoteReady = true;
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        void this.applyParams(p);
      } else if (data.candidate) {
        if (!p.remoteReady) p.pending.push(data.candidate);
        else await p.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (err) {
      console.warn('[host] sinalização', err);
    }
  }

  /* ---- internos ---- */

  private decorate(stream: MediaStream) {
    const prof = QUALITY_PROFILES[this.quality];
    stream.getTracks().forEach((t) => (t.enabled = !this.paused));
    const v = stream.getVideoTracks()[0];
    if (!v) return;
    try {
      v.contentHint = this.mode === 'detail' ? 'detail' : 'motion';
    } catch {
      /* ignora */
    }
    // Limita a captura ao perfil escolhido (economiza CPU em telas 4K). Falhas são inofensivas.
    void v
      .applyConstraints({
        width: { ideal: prof.width },
        height: { ideal: prof.height },
        frameRate: { ideal: prof.fps, max: prof.fps },
      })
      .catch(() => {});
  }

  private async connectViewer(id: string, epoch: string) {
    if (!this.stream || this.destroyed || !this.viewers.has(id)) return;
    const existing = this.peers.get(id);
    if (existing) {
      const st = existing.pc.connectionState;
      if (existing.epoch === epoch && (st === 'connected' || st === 'connecting' || st === 'new')) return;
      this.closePeer(id);
    }
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers, bundlePolicy: 'max-bundle' });
    const vTrack = this.stream.getVideoTracks()[0] ?? null;
    const aTrack = this.stream.getAudioTracks()[0] ?? null;
    // Os dois transceivers existem sempre: assim a troca de fonte (com ou sem áudio) não precisa renegociar.
    const vTx = vTrack ? pc.addTransceiver(vTrack, { direction: 'sendonly' }) : pc.addTransceiver('video', { direction: 'sendonly' });
    const aTx = aTrack ? pc.addTransceiver(aTrack, { direction: 'sendonly' }) : pc.addTransceiver('audio', { direction: 'sendonly' });
    preferCodecs(vTx);

    const peer: Peer = {
      id,
      epoch,
      sid: randomId(8),
      pc,
      video: vTx.sender,
      audio: aTx.sender,
      pending: [],
      remoteReady: false,
      level: 1,
      stable: 0,
      restarts: 0,
      restartTimer: null,
      audioTuned: false,
      lastBytes: 0,
      lastTs: 0,
      kbps: 0,
      rtt: null,
      loss: 0,
      limited: false,
      fw: null,
      fh: null,
      fps: null,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate && this.peers.get(id) === peer) this.opts.send(id, { sid: peer.sid, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.onPeerState(peer);
    await this.negotiate(peer, false);
  }

  private async negotiate(p: Peer, iceRestart: boolean) {
    if (this.peers.get(p.id) !== p) return;
    try {
      const offer = await p.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await p.pc.setLocalDescription(offer);
      if (this.peers.get(p.id) !== p || !p.pc.localDescription) return;
      this.opts.send(p.id, { sid: p.sid, description: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
      if (iceRestart) {
        // Se este restart também não conectar, tenta de novo (e, depois de algumas vezes, recria a conexão).
        if (p.restartTimer) clearTimeout(p.restartTimer);
        p.restartTimer = setTimeout(() => this.restartIce(p, false), 8000);
      }
    } catch (err) {
      console.warn('[host] negociação', err);
    }
  }

  private onPeerState(p: Peer) {
    if (this.peers.get(p.id) !== p) return;
    const st = p.pc.connectionState;
    if (st === 'connected') {
      if (p.restartTimer) clearTimeout(p.restartTimer);
      p.restartTimer = null;
      p.restarts = 0;
      void this.applyParams(p);
    } else if (st === 'disconnected') {
      if (p.restartTimer) clearTimeout(p.restartTimer);
      p.restartTimer = setTimeout(() => this.restartIce(p, false), 3000);
    } else if (st === 'failed') {
      if (p.restartTimer) clearTimeout(p.restartTimer);
      this.restartIce(p, false);
    }
    this.emit();
  }

  /** ICE restart quando a conexão cai; após várias falhas, recria a conexão do zero. */
  private restartIce(p: Peer, force: boolean) {
    if (this.peers.get(p.id) !== p || this.destroyed) return;
    if (!force && p.pc.connectionState === 'connected') return;
    p.restarts += 1;
    if (p.restarts > 4) {
      const { id, epoch } = p;
      this.closePeer(id);
      setTimeout(() => void this.connectViewer(id, epoch), 1000);
      return;
    }
    void this.negotiate(p, true);
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    if (p.restartTimer) clearTimeout(p.restartTimer);
    p.pc.onicecandidate = null;
    p.pc.onconnectionstatechange = null;
    try {
      p.pc.close();
    } catch {
      /* já fechado */
    }
  }

  private nativeScale(): number {
    const prof = QUALITY_PROFILES[this.quality];
    const s = this.stream?.getVideoTracks()[0]?.getSettings();
    const w = s?.width ?? prof.width;
    const h = s?.height ?? prof.height;
    return Math.max(1, w / prof.width, h / prof.height);
  }

  /** Ajusta bitrate, fps e resolução de cada espectador conforme perfil, nº de espectadores e qualidade do link. */
  private async applyParams(p: Peer) {
    if (this.peers.get(p.id) !== p) return;
    const prof = QUALITY_PROFILES[this.quality];
    const n = Math.max(1, this.peers.size);
    const share = n <= 2 ? 1 : Math.max(0.3, 2 / n); // muitos espectadores dividem o upload do host
    const target = Math.max(prof.minBitrate, Math.min(prof.maxBitrate, prof.maxBitrate * share * p.level));
    const ratio = target / prof.maxBitrate;

    let extraScale = 1;
    let fps = prof.fps;
    if (ratio < 0.5) {
      if (this.mode === 'detail') fps = Math.min(prof.fps, ratio < 0.3 ? 15 : 24); // mantém o texto nítido
      else extraScale = ratio < 0.25 ? 2 : 1.5; // mantém a fluidez
    }

    try {
      const params = p.video.getParameters();
      if (params.encodings && params.encodings.length) {
        const enc = params.encodings[0] as any;
        enc.maxBitrate = Math.round(target);
        enc.maxFramerate = fps;
        enc.scaleResolutionDownBy = Math.round(this.nativeScale() * extraScale * 100) / 100;
        enc.networkPriority = 'high';
        enc.priority = 'high';
        await p.video.setParameters(params);
      }
      if (!p.audioTuned) {
        const ap = p.audio.getParameters();
        if (ap.encodings && ap.encodings.length) {
          (ap.encodings[0] as any).maxBitrate = 160_000;
          await p.audio.setParameters(ap);
          p.audioTuned = true;
        }
      }
    } catch {
      /* será reaplicado no próximo ciclo */
    }
  }

  private async tick() {
    await Promise.all([...this.peers.values()].map((p) => this.poll(p)));
    this.emit();
  }

  private async poll(p: Peer) {
    if (p.pc.connectionState === 'closed') return;
    try {
      const report = await p.pc.getStats();
      let bytes = 0;
      let ts = 0;
      let loss = 0;
      let rtt = null as number | null;
      let limited = false;
      report.forEach((r: any) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          bytes = r.bytesSent ?? 0;
          ts = r.timestamp;
          limited = r.qualityLimitationReason === 'bandwidth';
          p.fw = r.frameWidth ?? p.fw;
          p.fh = r.frameHeight ?? p.fh;
          p.fps = r.framesPerSecond ?? p.fps;
        } else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
          loss = r.fractionLost ?? 0;
          if (typeof r.roundTripTime === 'number') rtt = r.roundTripTime * 1000;
        } else if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && rtt === null && typeof r.currentRoundTripTime === 'number') {
          rtt = r.currentRoundTripTime * 1000;
        }
      });
      if (p.lastTs && ts > p.lastTs) p.kbps = Math.max(0, ((bytes - p.lastBytes) * 8) / (ts - p.lastTs));
      p.lastBytes = bytes;
      p.lastTs = ts;
      p.rtt = rtt;
      p.loss = loss;
      p.limited = limited;
      this.adapt(p);
    } catch {
      /* conexão fechando */
    }
  }

  private adapt(p: Peer) {
    if (p.pc.connectionState !== 'connected') return;
    const bad = p.loss > 0.08 || (p.limited && p.loss > 0.03) || (p.rtt ?? 0) > 700;
    const good = p.loss < 0.02 && (p.rtt ?? 0) < 350 && !p.limited;
    if (bad) {
      p.stable = 0;
      p.level = Math.max(0.15, p.level * 0.7);
      void this.applyParams(p);
    } else if (good) {
      if (++p.stable >= 3 && p.level < 1) {
        p.stable = 0;
        p.level = Math.min(1, p.level * 1.2);
        void this.applyParams(p);
      }
    } else {
      p.stable = 0;
    }
  }

  private emit() {
    if (!this.opts.onStats || !this.stream) return;
    const connected = [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected');
    const first = connected[0];
    const rtts = connected.map((p) => p.rtt).filter((v): v is number => typeof v === 'number');
    this.opts.onStats({
      viewers: this.viewers.size,
      connected: connected.length,
      totalKbps: Math.round(connected.reduce((a, p) => a + p.kbps, 0)),
      rttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
      width: first?.fw ?? null,
      height: first?.fh ?? null,
      fps: first?.fps ? Math.round(first.fps) : null,
      reduced: connected.some((p) => p.level < 0.6),
    });
  }
}

/* ---------------------------------------------------------------- VIEWER */

interface ViewerOptions {
  iceServers: RTCIceServer[];
  send: (data: SignalData) => void;
  onStream: (stream: MediaStream | null) => void;
  onState: (state: MediaState) => void;
  onStats: (stats: ViewerStats | null) => void;
  onRequestStream: () => void;
}

function rateLink(lossPct: number, rttMs: number | null, jitterMs: number): LinkQuality {
  const rtt = rttMs ?? 0;
  if (lossPct > 8 || rtt > 500 || jitterMs > 100) return 'poor';
  if (lossPct > 3 || rtt > 250 || jitterMs > 50) return 'fair';
  if (lossPct > 1 || rtt > 120 || jitterMs > 25) return 'good';
  return 'excellent';
}

export class ViewerReceiver {
  private pc: RTCPeerConnection | null = null;
  private sid: string | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private remoteReady = false;
  private stream: MediaStream | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRequest = 0;
  private prev: { ts: number; bytes: number; lost: number; recv: number; jbDelay: number; jbCount: number } | null = null;

  constructor(private opts: ViewerOptions) {}

  async handleSignal(data: SignalData) {
    try {
      if (data.description?.type === 'offer') {
        // sid novo = o host criou uma conexão nova; mesmo sid = renegociação / ICE restart.
        if (!this.pc || this.sid !== data.sid) this.createPc(data.sid);
        const pc = this.pc!;
        await pc.setRemoteDescription(data.description);
        this.remoteReady = true;
        for (const c of this.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          this.opts.send({ sid: data.sid, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
      } else if (data.candidate && data.sid === this.sid) {
        if (!this.pc || !this.remoteReady) this.pending.push(data.candidate);
        else await this.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (err) {
      console.warn('[viewer] sinalização', err);
    }
  }

  /** Descarta a conexão atual (ex.: o host parou de transmitir). */
  reset() {
    this.teardown();
    this.opts.onStream(null);
    this.opts.onStats(null);
    this.opts.onState('waiting');
  }

  close() {
    this.teardown();
  }

  private teardown() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.failTimer) clearTimeout(this.failTimer);
    this.statsTimer = null;
    this.failTimer = null;
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        /* já fechado */
      }
    }
    this.pc = null;
    this.sid = null;
    this.stream = null;
    this.pending = [];
    this.remoteReady = false;
    this.prev = null;
  }

  private createPc(sid: string) {
    this.teardown();
    this.sid = sid;
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers, bundlePolicy: 'max-bundle' });
    const stream = new MediaStream();
    this.stream = stream;
    pc.ontrack = (e) => {
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      this.opts.onStream(stream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.opts.send({ sid, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.onState();
    this.pc = pc;
    this.opts.onState('connecting');
    this.statsTimer = setInterval(() => void this.poll(), 1000);
  }

  private onState() {
    const pc = this.pc;
    if (!pc) return;
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = null;
    switch (pc.connectionState) {
      case 'connected':
        this.opts.onState('connected');
        break;
      case 'disconnected':
        this.opts.onState('reconnecting');
        this.failTimer = setTimeout(() => this.requestRestart(), 4000);
        break;
      case 'failed':
        this.opts.onState('failed');
        this.requestRestart();
        break;
      default:
        this.opts.onState('connecting');
    }
  }

  private requestRestart() {
    const now = Date.now();
    if (now - this.lastRequest < 5000) return;
    this.lastRequest = now;
    this.opts.onRequestStream();
  }

  private async poll() {
    const pc = this.pc;
    if (!pc) return;
    try {
      const report = await pc.getStats();
      let bytes = 0, ts = 0, lost = 0, recv = 0, jitter = 0, jbDelay = 0, jbCount = 0, fps = 0, w = 0, h = 0;
      let rtt = null as number | null;
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          bytes = r.bytesReceived ?? 0;
          ts = r.timestamp;
          lost = r.packetsLost ?? 0;
          recv = r.packetsReceived ?? 0;
          jitter = (r.jitter ?? 0) * 1000;
          jbDelay = r.jitterBufferDelay ?? 0;
          jbCount = r.jitterBufferEmittedCount ?? 0;
          fps = r.framesPerSecond ?? 0;
          w = r.frameWidth ?? 0;
          h = r.frameHeight ?? 0;
        } else if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') {
          rtt = r.currentRoundTripTime * 1000;
        }
      });
      const prev = this.prev;
      this.prev = { ts, bytes, lost, recv, jbDelay, jbCount };
      if (!prev || ts <= prev.ts) return;
      const kbps = ((bytes - prev.bytes) * 8) / (ts - prev.ts);
      const dRecv = recv - prev.recv;
      const dLost = Math.max(0, lost - prev.lost);
      const lossPct = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
      const dCount = jbCount - prev.jbCount;
      const bufferMs = dCount > 0 ? ((jbDelay - prev.jbDelay) / dCount) * 1000 : null;
      this.opts.onStats({
        quality: rateLink(lossPct, rtt, jitter),
        kbps: Math.round(kbps),
        fps: Math.round(fps),
        width: w,
        height: h,
        lossPct: Math.round(lossPct * 10) / 10,
        rttMs: rtt === null ? null : Math.round(rtt),
        jitterMs: Math.round(jitter),
        latencyMs: bufferMs === null ? null : Math.round(bufferMs + (rtt ?? 0) / 2),
      });
    } catch {
      /* conexão fechando */
    }
  }
}
