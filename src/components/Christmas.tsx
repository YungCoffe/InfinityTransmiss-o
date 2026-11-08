'use client';

import { useEffect, useState } from 'react';
import { daysUntilChristmas } from '@/lib/theme';

/** Gorro de Papai Noel desenhado com o mesmo contorno preto grosso do resto da interface. */
export function SantaHat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M4 25C5 12 12 5 21 6c-2 5 0 13 7 19z" fill="#C8102E" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
      <rect x="2.5" y="22.5" width="26" height="6" rx="3" fill="#fff" stroke="#000" strokeWidth="2" />
      <circle cx="22" cy="6" r="3.3" fill="#fff" stroke="#000" strokeWidth="2" />
    </svg>
  );
}

export function ChristmasCountdown() {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => setDays(daysUntilChristmas()), []);
  if (days === null) return null;
  const text = days === 0 ? 'Hoje é Natal. Feliz Natal!' : days === 1 ? 'Falta 1 dia para o Natal' : `Faltam ${days} dias para o Natal`;
  return <span className="chip">{text}</span>;
}
