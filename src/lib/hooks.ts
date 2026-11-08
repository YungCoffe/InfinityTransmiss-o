'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RoomSession } from './room-session';
import { copyText } from './utils';

/** A sessão é criada uma vez por sala; o efeito inicia/encerra a conexão (compatível com o StrictMode). */
export function useRoomSession(code: string) {
  const [session] = useState(() => new RoomSession(code));
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.start();
    return () => session.destroy();
  }, [session]);
  return { session, snap };
}

export const useHostStats = (session: RoomSession) => useSyncExternalStore(session.subscribeStats, session.getHostStats, session.getHostStats);
export const useViewerStats = (session: RoomSession) => useSyncExternalStore(session.subscribeStats, session.getViewerStats, session.getViewerStats);

/** Mantém a tela acesa enquanto transmite ou assiste (celulares). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = typeof navigator !== 'undefined' ? (navigator as any).wakeLock : null;
    if (!active || !wl) return;
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await wl.request('screen');
      } catch {
        /* sem permissão ou bateria baixa */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [active]);
}

/** Segura um Web Lock enquanto o host transmite: ajuda o navegador a não suspender a aba em segundo plano. */
export function useKeepAlive(active: boolean) {
  useEffect(() => {
    const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : null;
    if (!active || !locks?.request) return;
    let release: (() => void) | null = null;
    let cancelled = false;
    locks
      .request('itx-keepalive', () => {
        if (cancelled) return Promise.resolve();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      release?.();
    };
  }, [active]);
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback((text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    });
  }, []);
  return [copied, copy];
}
