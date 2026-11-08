/**
 * WebRTC nativo em topologia de estrela:
 *   HostBroadcaster  → um RTCPeerConnection por espectador (o host sempre envia a oferta)
 *   ViewerReceiver   → um RTCPeerConnection que apenas responde e recebe
 * Cada conexão tem 3 "transceivers" fixos: vídeo principal (tela ou câmera), áudio (mixagem) e câmera-balão.
 * Trocar fonte, ligar a câmera ou o microfone usa replaceTrack e não renegocia nada.
 * Para evoluir para um SFU (LiveKit, mediasoup, Janus) basta trocar estas duas classes.
 */
import { isMobileDevice, randomId } from './utils';

export type SignalData = { sid: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export type QualityKey = 'max' | '1440p60' | '1080p60' | '1080p' | '720p' | '480p';
export type ContentMode = 'detail' | 'motion';
export type HostSource = 'screen' | 'camera';
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

/** Tetos de qualidade. O envio real se ajusta sozinho (rede, CPU, nº de espectadores e tela de cada espectador). */
export const QUALITY_PROFILES: Record<QualityKey, QualityProfile> = {
  max: { key: 'max', label: 'Máxima (até 4K, 60 fps)', width: 3840, height: 2160, fps: 60, maxBitrate: 20_000_000, minBitrate: 1_000_000 },
  '1440p60': { key: '1440p60', label: '1440p, 60 fps', width: 2560, height: 1440, fps: 60, maxBitrate: 14_000_000, minBitrate: 800_000 },
  '1080p60': { key: '1080p60', label: '1080p, 60 fps', width: 1920, height: 1080, fps: 60, maxBitrate: 10_000_000, minBitrate: 600_000 },
  '1080p': { key: '1080p', label: '1080p, 30 fps', width: 1920, height: 1080, fps: 30, maxBitrate: 6_000_000, minBitrate: 400_000 },
  '720p': { key: '720p', label: '720p, 30 fps', width: 1280, height: 720, fps: 30, maxBitrate: 3_000_000, minBitrate: 300_000 },
  '480p': { key: '480p', label: '480p, 30 fps (economia)', width: 854, height: 480, fps: 30, maxBitrate: 1_200_000, minBitrate: 200_000 },
};

export const AUDIO_KBPS = 192; // Opus estéreo
export const BUBBLE = { width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 }; // câmera sobre a tela

export interface HostTracks {
  video: MediaStreamTrack;
  audio: MediaStreamTrack | null;
  camera: MediaStreamTrack | null;
  source: HostSource;
}

export interface HostStats {
  viewers: number;
  connected: number;
  totalKbps: number;
  rttMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  reduced: boolean;
  cpuLimited: boolean;
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

export function shallowEqual(a: object | null, b: object | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof typeof a)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === (b as any)[k]);
}

/** Ordena os codecs de vídeo. "hardwareFirst" prioriza H.264 (decodifica/codifica em hardware quase sempre). */
function preferCodecs(tx: RTCRtpTransceiver, kind: 'send' | 'recv', hardwareFirst: boolean) {
  try {
    const api: any = kind === 'send' ? RTCRtpSender : RTCRtpReceiver;
    const caps = api.getCapabilities?.('video');
    if (!caps || typeof (tx as any).setCodecPreferences !== 'function') return;
    const order = hardwareFirst ? ['video/h264', 'video/vp9', 'video/vp8', 'video/av1'] : ['video/vp9', 'video/h264', 'video/vp8', 'video/av1'];
    const rank = (m: string) => {
      const i = order.indexOf(m.toLowerCase());
      return i < 0 ? order.length : i;
    };
    (tx as any).setCodecPreferences([...caps.codecs].sort((a: any, b: any) => rank(a.mimeType) - rank(b.mimeType)));
  } catch {
    /* mantém a ordem padrão */
  }
}

/** Opus em estéreo e com bitrate alto (padrão do WebRTC é mono e ~32 kbps). */
function tuneOpus(sdp: string, kbps: number): string {
  const lines = sdp.split(/\r?\n/);
  const pts = new Set<string>();
  const hasFmtp = new Set<string>();
  for (const l of lines) {
    const r = l.match(/^a=rtpmap:(\d+) opus\/48000\/2/i);
    if (r) pts.add(r[1]);
    const f = l.match(/^a=fmtp:(\d+) /);
    if (f) hasFmtp.add(f[1]);
  }
  if (!pts.size) return sdp;
  const want: [string, string][] = [
    ['stereo', '1'],
    ['sprop-stereo', '1'],
    ['maxaveragebitrate', String(kbps * 1000)],
    ['maxplaybackrate', '48000'],
    ['useinbandfec', '1'],
    ['usedtx', '0'],
  ];
  const merge = (existing: string) => {
    const map = new Map<string, string>();
    for (const part of existing.split(';')) {
      const s = part.trim();
      if (!s) continue;
      const i = s.indexOf('=');
      if (i < 0) map.set(s, '');
      else map.set(s.slice(0, i), s.slice(i + 1));
    }
    for (const [k, v] of want) map.set(k, v);
    return [...map].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';');
  };
  const out: string[] = [];
  for (const l of lines) {
    const f = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (f && pts.has(f[1])) {
      out.push(`a=fmtp:${f[1]} ${merge(f[2])}`);
      continue;
    }
    out.push(l);
    const r = l.match(/^a=rtpmap:(\d+) opus\/48000\/2/i);
    if (r && !hasFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} ${merge('')}`);
  }
  return out.join('\r\n');
}

async function setLocalTuned(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) {
  try {
    await pc.setLocalDescription({ type: desc.type, sdp: tuneOpus(desc.sdp ?? '', AUDIO_KBPS) });
  } catch {
    await pc.setLocalDescription(desc); // se o navegador recusar o ajuste, segue com o padrão
  }
}

/* ------------------------------------------------------------------ HOST */

interface Peer {
  id: string;
  epoch: string;
  maxHeight: number | null;
  sid: string;
  pc: RTCPeerConnection;
  vTx: RTCRtpTransceiver;
  video: RTCRtpSender;
  audio: RTCRtpSender;
  cam: RTCRtpSender;
  pending: RTCIceCandidateInit[];
  remoteReady: boolean;
  level: number;
  cpuScale: number;
  stable: number;
  cpuStreak: number;
  restarts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  audioTuned: boolean;
  lastBytes: number;
  lastTs: number;
  kbps: number;
  rtt: number | null;
  loss: number;
  limitedBw: boolean;
  limitedCpu: boolean;
  fw: number | null;
  fh: number | null;
  fps: number | null;
}

interface HostOptions {
  iceServers: RTCIceServer[];
  send: (to: string, data: SignalData) => void;
  onStats?: (stats: HostStats | null) => void;
}

interface ViewerInfo {
  epoch: string;
  maxHeight: number | null;
}

export class HostBroadcaster {
  private peers = new Map<string, Peer>();
  private viewers = new Map<string, ViewerInfo>();
  private tracks: HostTracks | null = null;
  private quality: QualityKey = '1080p';
  private mode: ContentMode = 'detail';
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  /** Pixels por segundo que este aparelho consegue codificar somando todos os espectadores (cada um é uma codificação). */
  private budget = isMobileDevice() ? 150e6 : 520e6;

  constructor(private opts: HostOptions) {}

  get streaming() {
    return this.tracks !== null;
  }

  start(tracks: HostTracks) {
    this.tracks = tracks;
    this.decorate();
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 2000);
    for (const [id, v] of this.viewers) void this.connectViewer(id, v);
  }

  /** Troca tela/câmera/áudio/balão sem renegociar: só substitui as faixas dos remetentes. */
  update(tracks: HostTracks) {
    this.tracks = tracks;
    this.decorate();
    for (const p of this.peers.values()) {
      this.replace(p);
      void this.applyParams(p);
    }
  }

  stop() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.tracks = null;
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
    const t = this.tracks;
    if (t) for (const tr of [t.video, t.audio, t.camera]) if (tr) tr.enabled = !paused;
  }

  setQuality(key: QualityKey) {
    this.quality = key;
    this.decorate();
    for (const p of this.peers.values()) void this.applyParams(p);
  }

  setMode(mode: ContentMode) {
    this.mode = mode;
    this.decorate(false);
    for (const p of this.peers.values()) void this.applyParams(p);
  }

  viewerJoined(id: string, epoch: string, maxHeight?: number | null) {
    const info = { epoch, maxHeight: maxHeight ?? null };
    this.viewers.set(id, info);
    if (this.tracks) void this.connectViewer(id, info);
  }

  viewerLeft(id: string) {
    this.viewers.delete(id);
    this.closePeer(id);
    this.emit();
  }

  viewerRequest(id: string, epoch: string, maxHeight?: number | null) {
    const info = { epoch, maxHeight: maxHeight ?? null };
    this.viewers.set(id, info);
    if (!this.tracks) return;
    const p = this.peers.get(id);
    if (p && p.epoch === epoch) this.restartIce(p, true);
    else void this.connectViewer(id, info);
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

  private decorate(constrain = true) {
    const t = this.tracks;
    if (!t) return;
    const prof = QUALITY_PROFILES[this.quality];
    for (const tr of [t.video, t.audio, t.camera]) if (tr) tr.enabled = !this.paused;
    try {
      // "detail" mantém texto nítido; "motion" prioriza fluidez. Câmeras sempre usam "motion".
      t.video.contentHint = t.source === 'camera' || this.mode === 'motion' ? 'motion' : 'detail';
      if (t.camera) t.camera.contentHint = 'motion';
    } catch {
      /* ignora */
    }
    if (constrain) {
      // Limita a captura ao perfil escolhido (economiza CPU em telas 4K). Falhas são inofensivas.
      void t.video
        .applyConstraints({ width: { ideal: prof.width }, height: { ideal: prof.height }, frameRate: { ideal: prof.fps, max: prof.fps } })
        .catch(() => {});
    }
  }

  private replace(p: Peer) {
    const t = this.tracks;
    if (!t) return;
    void p.video.replaceTrack(t.video).catch(() => {});
    void p.audio.replaceTrack(t.audio).catch(() => {});
    void p.cam.replaceTrack(t.camera).catch(() => {});
  }

  private async connectViewer(id: string, info: ViewerInfo) {
    const t = this.tracks;
    if (!t || this.destroyed || !this.viewers.has(id)) return;
    const existing = this.peers.get(id);
    if (existing) {
      const st = existing.pc.connectionState;
      existing.maxHeight = info.maxHeight;
      if (existing.epoch === info.epoch && (st === 'connected' || st === 'connecting' || st === 'new')) return;
      this.closePeer(id);
    }
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers, bundlePolicy: 'max-bundle' });
    // Três transceivers fixos (vídeo principal, áudio e câmera-balão): a ordem é como o espectador os identifica.
    const vTx = pc.addTransceiver(t.video, { direction: 'sendonly' });
    const aTx = pc.addTransceiver(t.audio ?? 'audio', { direction: 'sendonly' });
    const cTx = pc.addTransceiver(t.camera ?? 'video', { direction: 'sendonly' });
    const prof = QUALITY_PROFILES[this.quality];
    const hardwareFirst = prof.fps >= 60 || prof.height >= 1440 || t.source === 'camera';
    preferCodecs(vTx, 'send', hardwareFirst);
    preferCodecs(cTx, 'send', true);

    const peer: Peer = {
      id,
      epoch: info.epoch,
      maxHeight: info.maxHeight,
      sid: randomId(8),
      pc,
      vTx,
      video: vTx.sender,
      audio: aTx.sender,
      cam: cTx.sender,
      pending: [],
      remoteReady: false,
      level: 1,
      cpuScale: 1,
      stable: 0,
      cpuStreak: 0,
      restarts: 0,
      restartTimer: null,
      audioTuned: false,
      lastBytes: 0,
      lastTs: 0,
      kbps: 0,
      rtt: null,
      loss: 0,
      limitedBw: false,
      limitedCpu: false,
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
      await setLocalTuned(p.pc, offer);
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
      const { id } = p;
      const info = { epoch: p.epoch, maxHeight: p.maxHeight };
      this.closePeer(id);
      setTimeout(() => void this.connectViewer(id, info), 1000);
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

  /**
   * Ajusta bitrate, fps e resolução de cada espectador. Considera: teto do perfil, nº de espectadores (upload e CPU
   * são divididos), qualidade do link, CPU do aparelho e o tamanho real da tela de cada espectador.
   */
  private async applyParams(p: Peer) {
    const t = this.tracks;
    if (!t || this.peers.get(p.id) !== p) return;
    const prof = QUALITY_PROFILES[this.quality];
    const n = Math.max(1, this.peers.size);
    const share = n <= 2 ? 1 : Math.max(0.3, 2 / n);
    const target = Math.max(prof.minBitrate, Math.min(prof.maxBitrate, prof.maxBitrate * share * p.level));
    const ratio = target / prof.maxBitrate;

    const s = t.video.getSettings();
    const w = s.width || prof.width;
    const h = s.height || prof.height;
    let fps = prof.fps;
    let extra = 1;
    if (ratio < 0.5) {
      if (t.source === 'screen' && this.mode === 'detail') fps = Math.min(fps, ratio < 0.3 ? 15 : 24); // mantém o texto nítido
      else extra = ratio < 0.25 ? 2 : 1.5; // mantém a fluidez
    }
    let scale = Math.max(1, w / prof.width, h / prof.height) * extra * p.cpuScale;
    if (p.maxHeight) scale = Math.max(scale, h / p.maxHeight); // não envia mais pixels do que a tela do espectador mostra
    const cost = () => (w / scale) * (h / scale) * fps * n;
    if (cost() > this.budget && fps > 30) fps = 30;
    if (cost() > this.budget) scale *= Math.sqrt(cost() / this.budget);
    scale = Math.min(4, Math.round(scale * 100) / 100);

    try {
      const params = p.video.getParameters();
      if (params.encodings && params.encodings.length) {
        const enc = params.encodings[0] as any;
        enc.maxBitrate = Math.round(target);
        enc.maxFramerate = fps;
        enc.scaleResolutionDownBy = scale;
        enc.networkPriority = 'high';
        enc.priority = 'high';
        await p.video.setParameters(params);
      }
    } catch {
      /* será reaplicado no próximo ciclo */
    }

    if (t.camera) {
      try {
        const cs = t.camera.getSettings();
        const params = p.cam.getParameters();
        if (params.encodings && params.encodings.length) {
          const enc = params.encodings[0] as any;
          enc.maxBitrate = Math.round(BUBBLE.maxBitrate * Math.max(0.3, Math.min(1, share)));
          enc.maxFramerate = BUBBLE.fps;
          enc.scaleResolutionDownBy = Math.max(1, (cs.width || BUBBLE.width) / BUBBLE.width, (cs.height || BUBBLE.height) / BUBBLE.height);
          await p.cam.setParameters(params);
        }
      } catch {
        /* ignora */
      }
    }

    if (!p.audioTuned) {
      try {
        const ap = p.audio.getParameters();
        if (ap.encodings && ap.encodings.length) {
          (ap.encodings[0] as any).maxBitrate = AUDIO_KBPS * 1000;
          (ap.encodings[0] as any).networkPriority = 'high';
          await p.audio.setParameters(ap);
          p.audioTuned = true;
        }
      } catch {
        /* ignora */
      }
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
      const outs: any[] = [];
      const remotes: any[] = [];
      let pairRtt = null as number | null;
      report.forEach((r: any) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') outs.push(r);
        else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remotes.push(r);
        else if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && typeof r.currentRoundTripTime === 'number') pairRtt = r.currentRoundTripTime * 1000;
      });
      const area = (r: any) => (r.frameWidth ?? 0) * (r.frameHeight ?? 0);
      const main = outs.find((r) => r.mid !== undefined && r.mid === p.vTx.mid) ?? [...outs].sort((a, b) => area(b) - area(a))[0];
      if (!main) return;
      const remote = remotes.find((r) => r.ssrc === main.ssrc) ?? remotes[0];
      const bytes = main.bytesSent ?? 0;
      const ts = main.timestamp;
      if (p.lastTs && ts > p.lastTs) p.kbps = Math.max(0, ((bytes - p.lastBytes) * 8) / (ts - p.lastTs));
      p.lastBytes = bytes;
      p.lastTs = ts;
      p.fw = main.frameWidth ?? p.fw;
      p.fh = main.frameHeight ?? p.fh;
      p.fps = main.framesPerSecond ?? p.fps;
      p.limitedBw = main.qualityLimitationReason === 'bandwidth';
      p.limitedCpu = main.qualityLimitationReason === 'cpu';
      p.loss = remote?.fractionLost ?? 0;
      p.rtt = typeof remote?.roundTripTime === 'number' ? remote.roundTripTime * 1000 : pairRtt;
      this.adapt(p);
    } catch {
      /* conexão fechando */
    }
  }

  private adapt(p: Peer) {
    if (p.pc.connectionState !== 'connected') return;
    // CPU no limite: reduz a resolução enviada (mais efetivo do que reduzir só o bitrate).
    p.cpuStreak = p.limitedCpu ? p.cpuStreak + 1 : 0;
    let changed = false;
    if (p.cpuStreak >= 2) {
      p.cpuStreak = 0;
      p.cpuScale = Math.min(2.5, p.cpuScale * 1.25);
      changed = true;
    }
    const bad = p.loss > 0.08 || (p.limitedBw && p.loss > 0.03) || (p.rtt ?? 0) > 700;
    const good = p.loss < 0.02 && (p.rtt ?? 0) < 350 && !p.limitedBw && !p.limitedCpu;
    if (bad) {
      p.stable = 0;
      p.level = Math.max(0.15, p.level * 0.7);
      changed = true;
    } else if (good) {
      if (++p.stable >= 3) {
        p.stable = 0;
        if (p.level < 1) {
          p.level = Math.min(1, p.level * 1.2);
          changed = true;
        } else if (p.cpuScale > 1) {
          p.cpuScale = Math.max(1, p.cpuScale / 1.1);
          changed = true;
        }
      }
    } else {
      p.stable = 0;
    }
    if (changed) void this.applyParams(p);
  }

  private emit() {
    if (!this.opts.onStats || !this.tracks) return;
    const connected = [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected');
    const first = connected[0];
    const rtts = connected.map((p) => p.rtt).filter((v): v is number => typeof v === 'number');
    this.opts.onStats({
      viewers: this.viewers.size,
      connected: connected.length,
      totalKbps: Math.round(connected.reduce((a, p) => a + p.kbps, 0) / 10) * 10,
      rttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
      width: first?.fw ?? null,
      height: first?.fh ?? null,
      fps: first?.fps ? Math.round(first.fps) : null,
      reduced: connected.some((p) => p.level < 0.6),
      cpuLimited: connected.some((p) => p.cpuScale > 1.2),
    });
  }
}

/* ---------------------------------------------------------------- VIEWER */

interface ViewerOptions {
  iceServers: RTCIceServer[];
  send: (data: SignalData) => void;
  onStream: (stream: MediaStream | null) => void;
  onCamera: (stream: MediaStream | null) => void;
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
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRequest = 0;
  private prev: { ts: number; bytes: number; lost: number; recv: number; jbDelay: number; jbCount: number } | null = null;

  constructor(private opts: ViewerOptions) {}

  async handleSignal(data: SignalData) {
    try {
      if (data.description?.type === 'offer') {
        // sid novo = o host criou uma conexão nova; mesmo sid = renegociação / ICE restart.
        const fresh = !this.pc || this.sid !== data.sid;
        if (fresh) this.createPc(data.sid);
        const pc = this.pc!;
        await pc.setRemoteDescription(data.description);
        this.remoteReady = true;
        // Celulares: H.264 primeiro (decodificação por hardware = menos bateria e calor).
        if (fresh && isMobileDevice()) {
          for (const tx of pc.getTransceivers()) if (tx.receiver.track.kind === 'video') preferCodecs(tx, 'recv', true);
        }
        for (const c of this.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        const answer = await pc.createAnswer();
        await setLocalTuned(pc, answer);
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
    this.opts.onCamera(null);
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
    this.pending = [];
    this.remoteReady = false;
    this.prev = null;
  }

  private createPc(sid: string) {
    this.teardown();
    this.sid = sid;
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers, bundlePolicy: 'max-bundle' });
    const main = new MediaStream();
    const cam = new MediaStream();
    pc.ontrack = (e) => {
      // O primeiro vídeo da oferta é o principal; o segundo é a câmera-balão. O áudio vai junto com o principal.
      const videos = pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video');
      const isCam = e.track.kind === 'video' && videos.indexOf(e.transceiver) > 0;
      const target = isCam ? cam : main;
      if (!target.getTracks().includes(e.track)) target.addTrack(e.track);
      if (isCam) this.opts.onCamera(cam);
      else this.opts.onStream(main);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.opts.send({ sid, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.onState();
    this.pc = pc;
    this.opts.onState('connecting');
    // As métricas só alimentam o indicador de qualidade: 2 s bastam e economizam bateria.
    this.statsTimer = setInterval(() => void this.poll(), 2000);
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
    if (!pc || (typeof document !== 'undefined' && document.hidden)) return; // aba em segundo plano: sem custo
    try {
      const report = await pc.getStats();
      const inbound: any[] = [];
      let rtt = null as number | null;
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') inbound.push(r);
        else if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
      });
      const mainMid = pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video')[0]?.mid;
      const area = (r: any) => (r.frameWidth ?? 0) * (r.frameHeight ?? 0);
      const r = inbound.find((x) => x.mid !== undefined && x.mid === mainMid) ?? [...inbound].sort((a, b) => area(b) - area(a))[0];
      if (!r) return;
      const bytes = r.bytesReceived ?? 0;
      const ts = r.timestamp;
      const lost = r.packetsLost ?? 0;
      const recv = r.packetsReceived ?? 0;
      const jbDelay = r.jitterBufferDelay ?? 0;
      const jbCount = r.jitterBufferEmittedCount ?? 0;
      const prev = this.prev;
      this.prev = { ts, bytes, lost, recv, jbDelay, jbCount };
      if (!prev || ts <= prev.ts) return;
      const kbps = ((bytes - prev.bytes) * 8) / (ts - prev.ts);
      const dRecv = recv - prev.recv;
      const dLost = Math.max(0, lost - prev.lost);
      const lossPct = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
      const dCount = jbCount - prev.jbCount;
      const bufferMs = dCount > 0 ? ((jbDelay - prev.jbDelay) / dCount) * 1000 : null;
      const jitter = (r.jitter ?? 0) * 1000;
      this.opts.onStats({
        quality: rateLink(lossPct, rtt, jitter),
        kbps: Math.round(kbps / 10) * 10,
        fps: Math.round(r.framesPerSecond ?? 0),
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
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
