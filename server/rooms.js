'use strict';

const config = require('./config');
const sec = require('./security');

class RoomError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const TOMBSTONE_MS = 30 * 60 * 1000;

/**
 * Estado das salas somente em memória (sem banco de dados).
 * Participantes são identificados por clientId (estável entre reconexões), não pelo id do socket.
 */
class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.tombstones = new Map(); // código -> expira em (ms); mostra "Sala encerrada" em vez de "não encontrada"
    this.onClosed = null; // (room, reason) => void
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.sweep(), 30 * 1000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async create({ name, password }) {
    if (this.rooms.size >= config.maxRooms) throw new RoomError('SERVER_BUSY');
    let code = null;
    for (let i = 0; i < 20; i++) {
      const candidate = sec.generateCode();
      if (!this.rooms.has(candidate) && !this.tombstones.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new RoomError('SERVER');
    const hostKey = sec.newHostKey();
    const now = Date.now();
    const room = {
      code,
      hostName: name,
      hostKeyHash: sec.hashHostKey(hostKey, config.sessionSecret),
      passwordHash: password ? await sec.hashPassword(password) : null,
      status: 'open',
      createdAt: now,
      lastActivityAt: now,
      hostClientId: null,
      participants: new Map(),
      stream: { streaming: false, paused: false },
    };
    this.rooms.set(code, room);
    return { room, hostKey };
  }

  /** Retorna a sala aberta, { status: 'closed' } para salas encerradas, ou null se não existir. */
  get(code) {
    const live = this.rooms.get(code);
    if (live) return live;
    if (this.tombstones.has(code)) return { code, status: 'closed' };
    return null;
  }

  isHostKey(room, key) {
    if (typeof key !== 'string' || key.length < 16 || key.length > 128 || !room.hostKeyHash) return false;
    return sec.safeEqual(sec.hashHostKey(key, config.sessionSecret), room.hostKeyHash);
  }

  viewerCount(room) {
    let n = 0;
    for (const p of room.participants.values()) if (p.role === 'viewer' && p.status !== 'disconnected') n++;
    return n;
  }

  activeViewers(room) {
    const out = [];
    for (const p of room.participants.values()) {
      if (p.role === 'viewer' && p.status !== 'disconnected') out.push({ clientId: p.clientId, epoch: p.epoch });
    }
    return out;
  }

  list(room) {
    return [...room.participants.values()]
      .sort((a, b) => Number(b.role === 'host') - Number(a.role === 'host') || a.joinedAt - b.joinedAt)
      .map((p) => ({ clientId: p.clientId, name: p.name, role: p.role, status: p.status, joinedAt: p.joinedAt }));
  }

  publicInfo(room, isHost) {
    return {
      code: room.code,
      hostName: room.hostName,
      passwordRequired: !!room.passwordHash,
      status: room.status,
      viewers: this.viewerCount(room),
      maxViewers: config.maxViewers,
      isHost: !!isHost,
      streaming: room.stream.streaming,
    };
  }

  close(room, reason) {
    if (room.status === 'closed') return;
    room.status = 'closed';
    for (const p of room.participants.values()) {
      clearTimeout(p.graceTimer);
      clearTimeout(p.removeTimer);
    }
    this.rooms.delete(room.code);
    this.tombstones.set(room.code, Date.now() + TOMBSTONE_MS);
    if (this.onClosed) this.onClosed(room, reason);
  }

  /** Expira salas sem ninguém conectado por mais que ROOM_INACTIVITY_MINUTES. */
  sweep() {
    const now = Date.now();
    for (const [code, until] of this.tombstones) if (until <= now) this.tombstones.delete(code);
    for (const room of [...this.rooms.values()]) {
      const active = [...room.participants.values()].some((p) => p.status !== 'disconnected');
      if (active) room.lastActivityAt = now;
      else if (now - room.lastActivityAt > config.roomInactivityMs) this.close(room, 'expired');
    }
  }
}

module.exports = { RoomManager, RoomError };
