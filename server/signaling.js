'use strict';

const config = require('./config');
const sec = require('./security');
const { RoomError } = require('./rooms');

const ok = (extra) => ({ ok: true, ...(extra || {}) });
const fail = (error) => ({ ok: false, error });

/**
 * Sinalização WebRTC via Socket.IO.
 * Topologia em estrela: o host envia uma oferta para cada espectador; espectadores só falam com o host.
 * (Para trocar por um SFU como LiveKit/mediasoup/Janus, basta substituir este relay de ofertas/respostas.)
 */
function registerSignaling(io, manager) {
  const createLimiter = new sec.RateLimiter(5, 15 * 60 * 1000);
  const joinLimiter = new sec.RateLimiter(60, 60 * 1000);
  const passwordLimiter = new sec.RateLimiter(8, 5 * 60 * 1000);
  const requestLimiter = new sec.RateLimiter(6, 30 * 1000);
  const connections = new Map();

  const sweeper = setInterval(() => {
    createLimiter.sweep();
    joinLimiter.sweep();
    passwordLimiter.sweep();
    requestLimiter.sweep();
  }, 60 * 1000);
  sweeper.unref();

  manager.onClosed = (room, reason) => {
    io.to(room.code).emit('room:closed', { reason });
    io.in(room.code).socketsLeave(room.code);
  };

  const emitTo = (room, clientId, event, payload) => {
    const p = room.participants.get(clientId);
    if (p && p.socketId && p.status !== 'disconnected') io.to(p.socketId).emit(event, payload);
  };
  const toHost = (room, event, payload) => {
    if (room.hostClientId) emitTo(room, room.hostClientId, event, payload);
  };
  const broadcast = (room) => io.to(room.code).emit('participants', manager.list(room));

  function removeParticipant(room, part) {
    clearTimeout(part.graceTimer);
    clearTimeout(part.removeTimer);
    if (room.participants.get(part.clientId) === part) room.participants.delete(part.clientId);
    if (part.role === 'viewer') toHost(room, 'viewer:left', { clientId: part.clientId });
    if (room.hostClientId === part.clientId) room.hostClientId = null;
    broadcast(room);
  }

  function markDisconnected(room, part) {
    clearTimeout(part.graceTimer);
    part.status = 'disconnected';
    part.socketId = null;
    if (part.role === 'viewer') {
      toHost(room, 'viewer:left', { clientId: part.clientId });
    } else if (room.stream.streaming) {
      room.stream = { streaming: false, paused: false };
      io.to(room.code).emit('stream:state', room.stream);
    }
    broadcast(room);
    clearTimeout(part.removeTimer);
    part.removeTimer = setTimeout(() => {
      if (part.status === 'disconnected') removeParticipant(room, part);
    }, config.removeDisconnectedAfterMs);
  }

  io.use((socket, next) => {
    const ip = sec.getClientIp(socket.handshake.headers, socket.handshake.address);
    if ((connections.get(ip) || 0) >= config.maxConnectionsPerIp) return next(new Error('rate_limited'));
    socket.data.ip = ip;
    next();
  });

  io.on('connection', (socket) => {
    const ip = socket.data.ip;
    connections.set(ip, (connections.get(ip) || 0) + 1);

    // Limite de eventos por socket (ICE gera rajadas, por isso o teto é generoso).
    const bucket = { count: 0, reset: Date.now() + 10000 };
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now > bucket.reset) {
        bucket.count = 0;
        bucket.reset = now + 10000;
      }
      if (++bucket.count > 800) {
        socket.disconnect(true);
        return next(new Error('rate_limited'));
      }
      next();
    });

    const handle = (fn) => async (payload, ack) => {
      let res;
      try {
        res = await fn(payload && typeof payload === 'object' ? payload : {});
      } catch (err) {
        if (!(err instanceof RoomError)) console.error('[signaling]', err);
        res = fail(err && err.code ? err.code : 'SERVER');
      }
      if (typeof ack === 'function') ack(res);
    };

    const ctx = (role) => {
      const b = socket.data.binding;
      if (!b) return null;
      const room = manager.rooms.get(b.code);
      if (!room) return null;
      const part = room.participants.get(b.clientId);
      if (!part || part.socketId !== socket.id) return null;
      if (role && part.role !== role) return null;
      return { room, part };
    };

    socket.on(
      'room:create',
      handle(async (p) => {
        if (!createLimiter.take(ip)) return fail('RATE_LIMITED');
        const name = sec.sanitizeName(p.name, 'Apresentador');
        const password = sec.sanitizePassword(p.password);
        const { room, hostKey } = await manager.create({ name, password });
        return ok({ code: room.code, hostKey });
      })
    );

    socket.on(
      'room:info',
      handle(async (p) => {
        const code = sec.normalizeCode(p.code);
        if (!code) return fail('NOT_FOUND');
        if (!joinLimiter.take(ip)) return fail('RATE_LIMITED');
        const room = manager.get(code);
        if (!room) return fail('NOT_FOUND');
        if (room.status === 'closed') return fail('CLOSED');
        return ok({ room: manager.publicInfo(room, manager.isHostKey(room, p.hostKey)) });
      })
    );

    socket.on(
      'room:join',
      handle(async (p) => {
        const code = sec.normalizeCode(p.code);
        if (!code) return fail('NOT_FOUND');
        if (!sec.isValidId(p.clientId) || !sec.isValidId(p.epoch)) return fail('INVALID');
        if (!joinLimiter.take(ip)) return fail('RATE_LIMITED');

        const room = manager.get(code);
        if (!room) return fail('NOT_FOUND');
        if (room.status === 'closed') return fail('CLOSED');

        const isHost = manager.isHostKey(room, p.hostKey);
        const clientId = p.clientId;
        const prev = room.participants.get(clientId);

        if (!isHost) {
          if (room.passwordHash) {
            const pw = sec.sanitizePassword(p.password);
            if (!pw) return fail('PASSWORD_REQUIRED');
            const key = `${ip}:${code}`;
            if (passwordLimiter.isLimited(key)) return fail('RATE_LIMITED');
            if (!(await sec.verifyPassword(pw, room.passwordHash))) {
              passwordLimiter.hit(key);
              return fail('WRONG_PASSWORD');
            }
            if (room.status === 'closed') return fail('CLOSED');
          }
          if (prev && prev.role === 'host') return fail('FORBIDDEN');
          const alreadyIn = prev && prev.role === 'viewer' && prev.status !== 'disconnected';
          if (!alreadyIn && manager.viewerCount(room) >= config.maxViewers) return fail('FULL');
        }

        const name = sec.sanitizeName(p.name, isHost ? room.hostName : 'Visitante');

        // Mesma identidade em outro socket (outra aba / reconexão): a sessão antiga é substituída.
        if (prev && prev.socketId && prev.socketId !== socket.id) {
          const old = io.sockets.sockets.get(prev.socketId);
          if (old) {
            old.data.binding = null;
            old.leave(room.code);
            old.emit('session:replaced');
          }
        }
        // Outra aba do host assume a apresentação.
        if (isHost && room.hostClientId && room.hostClientId !== clientId) {
          const oldHost = room.participants.get(room.hostClientId);
          if (oldHost) {
            if (oldHost.socketId) {
              const old = io.sockets.sockets.get(oldHost.socketId);
              if (old) {
                old.data.binding = null;
                old.leave(room.code);
                old.emit('session:replaced');
              }
            }
            removeParticipant(room, oldHost);
          }
        }

        if (socket.data.binding && socket.data.binding.code !== room.code) socket.leave(socket.data.binding.code);

        const part = prev || { clientId, joinedAt: Date.now() };
        clearTimeout(part.graceTimer);
        clearTimeout(part.removeTimer);
        Object.assign(part, {
          name,
          role: isHost ? 'host' : 'viewer',
          status: 'connected',
          socketId: socket.id,
          epoch: p.epoch,
        });
        room.participants.set(clientId, part);
        if (isHost) room.hostClientId = clientId;

        socket.join(room.code);
        socket.data.binding = { code: room.code, clientId };
        room.lastActivityAt = Date.now();

        broadcast(room);
        if (!isHost) toHost(room, 'viewer:joined', { clientId, epoch: part.epoch });

        return ok({
          role: part.role,
          you: { clientId, name: part.name },
          room: manager.publicInfo(room, isHost),
          participants: manager.list(room),
          stream: room.stream,
          iceServers: config.iceServers(),
          viewers: isHost ? manager.activeViewers(room) : undefined,
        });
      })
    );

    socket.on('room:leave', () => {
      const c = ctx();
      if (!c) return;
      socket.leave(c.room.code);
      socket.data.binding = null;
      if (c.part.role === 'viewer') removeParticipant(c.room, c.part);
      else markDisconnected(c.room, c.part);
    });

    socket.on(
      'room:close',
      handle(async () => {
        const c = ctx('host');
        if (!c) return fail('FORBIDDEN');
        manager.close(c.room, 'host');
        return ok();
      })
    );

    socket.on(
      'stream:state',
      handle(async (p) => {
        const c = ctx('host');
        if (!c) return fail('FORBIDDEN');
        const streaming = p.streaming === true;
        c.room.stream = { streaming, paused: streaming && p.paused === true };
        c.room.lastActivityAt = Date.now();
        io.to(c.room.code).emit('stream:state', c.room.stream);
        return ok();
      })
    );

    socket.on('signal', (p) => {
      const c = ctx();
      if (!c || !p || typeof p !== 'object' || !sec.validSignal(p.data)) return;
      const { room, part } = c;
      let targetId;
      if (part.role === 'viewer') targetId = room.hostClientId;
      else if (sec.isValidId(p.to)) targetId = p.to;
      else return;
      const target = room.participants.get(targetId);
      if (!target || !target.socketId || target.status === 'disconnected') return;
      if (part.role === 'host' && target.role !== 'viewer') return;
      io.to(target.socketId).emit('signal', { from: part.clientId, data: p.data });
    });

    // O espectador perdeu o vídeo (rede caiu, página recarregou...) e pede uma nova negociação ao host.
    socket.on('viewer:request-stream', () => {
      const c = ctx('viewer');
      if (!c || !requestLimiter.take(c.part.clientId)) return;
      toHost(c.room, 'viewer:request', { clientId: c.part.clientId, epoch: c.part.epoch });
    });

    socket.on('disconnect', () => {
      connections.set(ip, Math.max(0, (connections.get(ip) || 1) - 1));
      const b = socket.data.binding;
      if (!b) return;
      const room = manager.rooms.get(b.code);
      if (!room) return;
      const part = room.participants.get(b.clientId);
      if (!part || part.socketId !== socket.id) return;
      // Queda temporária: mantém o participante como "reconectando" antes de marcá-lo como desconectado.
      part.socketId = null;
      part.status = 'reconnecting';
      broadcast(room);
      clearTimeout(part.graceTimer);
      part.graceTimer = setTimeout(() => markDisconnected(room, part), config.reconnectGraceMs);
    });
  });
}

module.exports = { registerSignaling };
