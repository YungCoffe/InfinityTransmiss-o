/**
 * Captura local: câmera e mixagem de áudio.
 * Todo o áudio enviado passa por UMA faixa (a saída do WebAudio), então trocar de tela/aba ou ligar/desligar o
 * microfone nunca exige renegociar a conexão WebRTC.
 */

export interface CameraOptions {
  width: number;
  height: number;
  fps: number;
  deviceId?: string;
  facingMode?: 'user' | 'environment';
}
export interface CameraInfo {
  id: string;
  label: string;
}

/** Abre a câmera pedindo o melhor modo disponível (o navegador escolhe o mais próximo do pedido). */
export async function openCamera(o: CameraOptions): Promise<MediaStream> {
  const base: any = { width: { ideal: o.width }, height: { ideal: o.height }, frameRate: { ideal: o.fps } };
  const open = (video: any) => navigator.mediaDevices.getUserMedia({ video, audio: false });
  if (o.deviceId) {
    try {
      return await open({ ...base, deviceId: { exact: o.deviceId } });
    } catch (e: any) {
      if (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError') throw e;
    }
  }
  return open(o.facingMode ? { ...base, facingMode: { ideal: o.facingMode } } : base);
}

export async function listCameras(): Promise<CameraInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Câmera ${i + 1}` }));
  } catch {
    return [];
  }
}

export class Capture {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private micGain: GainNode | null = null;
  private sysGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private sysSource: MediaStreamAudioSourceNode | null = null;
  private levelBuf: Uint8Array | null = null;
  hasSystemAudio = false;

  get micActive() {
    return this.micStream !== null;
  }

  /** Cria (ou retoma) o AudioContext. Chame dentro de um clique: iOS e Safari exigem esse gesto. */
  prepareAudio() {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AC: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        let ctx: AudioContext;
        try {
          ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
        } catch {
          ctx = new AC();
        }
        const dest = ctx.createMediaStreamDestination();
        dest.channelCount = 2;
        const micGain = ctx.createGain();
        const sysGain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        micGain.connect(dest);
        micGain.connect(analyser);
        sysGain.connect(dest);
        this.ctx = ctx;
        this.dest = dest;
        this.micGain = micGain;
        this.sysGain = sysGain;
        this.analyser = analyser;
        this.levelBuf = new Uint8Array(analyser.fftSize);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* sem WebAudio: o envio continua, apenas sem mixagem de áudio */
    }
  }

  /** Faixa única de áudio enviada aos espectadores (silenciosa quando não há entrada). */
  audioTrack(): MediaStreamTrack | null {
    return this.dest?.stream.getAudioTracks()[0] ?? null;
  }

  /** Liga o áudio da aba/sistema (vindo do getDisplayMedia) à mixagem. */
  setSystemAudio(stream: MediaStream | null) {
    try {
      this.sysSource?.disconnect();
    } catch {
      /* ignora */
    }
    this.sysSource = null;
    const tracks = stream ? stream.getAudioTracks() : [];
    this.hasSystemAudio = tracks.length > 0;
    if (!tracks.length || !this.ctx || !this.sysGain) return;
    this.sysSource = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    this.sysSource.connect(this.sysGain);
  }

  /** Liga o microfone. "processing" ativa cancelamento de eco, supressão de ruído e ganho automático (ideal para voz). */
  async enableMic(processing: boolean) {
    this.prepareAudio();
    if (!this.ctx || !this.micGain) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    this.disableMic();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
      } as MediaTrackConstraints,
      video: false,
    });
    this.micStream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.micGain);
  }

  disableMic() {
    try {
      this.micSource?.disconnect();
    } catch {
      /* ignora */
    }
    this.micSource = null;
    this.micStream?.getTracks().forEach((t) => t.stop()); // solta o dispositivo: o indicador de microfone apaga
    this.micStream = null;
  }

  /** Volume atual do microfone, de 0 a 1. */
  level(): number {
    if (!this.analyser || !this.levelBuf || !this.micStream) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf as any);
    let peak = 0;
    for (let i = 0; i < this.levelBuf.length; i++) peak = Math.max(peak, Math.abs(this.levelBuf[i] - 128));
    return Math.min(1, peak / 64);
  }

  stop() {
    this.disableMic();
    this.setSystemAudio(null);
    try {
      void this.ctx?.close();
    } catch {
      /* ignora */
    }
    this.ctx = this.dest = this.micGain = this.sysGain = this.analyser = null;
    this.levelBuf = null;
  }
}
