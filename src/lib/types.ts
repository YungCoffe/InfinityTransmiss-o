export type Role = 'host' | 'viewer';
export type PeerStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface Participant {
  clientId: string;
  name: string;
  role: Role;
  status: PeerStatus;
  joinedAt: number;
}

export interface StreamState {
  streaming: boolean;
  paused: boolean;
  /** O que aparece no vídeo principal. */
  source: 'screen' | 'camera';
  /** Há uma câmera sobre a tela (balão). */
  camera: boolean;
}

export interface RoomInfo {
  code: string;
  hostName: string;
  passwordRequired: boolean;
  status: 'open' | 'closed';
  viewers: number;
  maxViewers: number;
  isHost: boolean;
  streaming: boolean;
}

export interface AckFail {
  ok: false;
  error: string;
}
export interface InfoOk {
  ok: true;
  room: RoomInfo;
}
export interface CreateOk {
  ok: true;
  code: string;
  hostKey: string;
}
export interface JoinOk {
  ok: true;
  role: Role;
  you: { clientId: string; name: string };
  room: RoomInfo;
  participants: Participant[];
  stream: StreamState;
  iceServers: RTCIceServer[];
  viewers?: { clientId: string; epoch: string; maxHeight: number | null }[];
}
