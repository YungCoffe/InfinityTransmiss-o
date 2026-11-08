'use client';

import { useEffect, useRef } from 'react';

type Flake = { x: number; y: number; r: number; v: number; d: number; p: number };

/**
 * Neve em canvas, restrita ao elemento pai (que precisa ser "relative"). Só existe na página inicial.
 * Otimizações: pausa quando fora da tela ou com a aba oculta, 30 quadros e menos flocos no celular,
 * desligada com "reduzir movimento" ou economia de dados.
 */
export default function Snow({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || !active) return;
    const conn: any = (navigator as any).connection;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || conn?.saveData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const frameMs = coarse ? 1000 / 30 : 1000 / 60;
    const maxFlakes = coarse ? 40 : 90;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let visible = true;
    let flakes: Flake[] = [];

    const spawn = (anywhere: boolean): Flake => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -8,
      r: 1 + Math.random() * 2.6,
      v: 18 + Math.random() * 38,
      d: 8 + Math.random() * 18,
      p: Math.random() * Math.PI * 2,
    });

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      flakes = Array.from({ length: Math.min(maxFlakes, Math.round((w * h) / 9000)) }, () => spawn(true));
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < frameMs - 2) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000);
      last = t;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const f of flakes) {
        f.y += f.v * dt;
        f.p += dt * 0.9;
        if (f.y > h + 8) Object.assign(f, spawn(false));
        ctx.beginPath();
        ctx.arc(f.x + Math.sin(f.p) * f.d, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const update = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    io.observe(parent);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [active]);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
