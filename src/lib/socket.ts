import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Um único socket por aba, no mesmo domínio do site (o servidor Socket.IO divide a porta com o Next.js). */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
  }
  return socket;
}

/** Conecta (ou reaproveita a conexão). Rejeita com Error('offline') se o servidor não responder. */
export function connectSocket(timeoutMs = 10000): Promise<Socket> {
  const s = getSocket();
  if (s.connected) return Promise.resolve(s);
  return new Promise<Socket>((resolve, reject) => {
    let fails = 0;
    const cleanup = () => {
      clearTimeout(timer);
      s.off('connect', onOk);
      s.off('connect_error', onErr);
    };
    const giveUp = () => {
      cleanup();
      s.disconnect();
      reject(new Error('offline'));
    };
    const onOk = () => {
      cleanup();
      resolve(s);
    };
    const onErr = () => {
      if (++fails >= 2) giveUp();
    };
    const timer = setTimeout(giveUp, timeoutMs);
    s.on('connect', onOk);
    s.on('connect_error', onErr);
    if (!s.active) s.connect();
  });
}

/** emit com confirmação (ack) e tempo limite. */
export function request<T = unknown>(s: Socket, event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: T) => (err ? reject(new Error('timeout')) : resolve(res)));
  });
}
