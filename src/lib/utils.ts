const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** Aceita "ab3x9k", "AB3 X9K" ou o link completo da sala e devolve o código válido (ou null). */
export function normalizeCode(input: string): string | null {
  const fromLink = input.match(/\/sala\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/);
  const raw = (fromLink ? fromLink[1] : input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(raw) ? raw : null;
}

/** Id aleatório em hexadecimal (funciona também em páginas sem HTTPS, ao contrário de crypto.randomUUID). */
export function randomId(bytes = 12): string {
  const a = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* modo privado / storage bloqueado */
  }
}

let memoryClientId: string | null = null;
/** Identidade estável desta aba (sobrevive a recarregar e a quedas de conexão). */
export function getClientId(): string {
  try {
    let id = window.sessionStorage.getItem('itx:cid');
    if (!id) {
      id = randomId(12);
      window.sessionStorage.setItem('itx:cid', id);
    }
    return id;
  } catch {
    return (memoryClientId ??= randomId(12));
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* tenta o método antigo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const roomLink = (code: string) => `${window.location.origin}/sala/${code}`;

export const supportsWebRTC = () => typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined';
export const supportsDisplayCapture = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function formatKbps(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}
