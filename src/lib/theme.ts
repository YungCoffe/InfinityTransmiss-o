/**
 * Tema de Natal. Para desligar: defina NEXT_PUBLIC_CHRISTMAS=off no Render e faça um novo deploy
 * (a variável é lida na hora do build). Nada além de neve, gorro e contagem regressiva depende dela.
 */
export const CHRISTMAS = process.env.NEXT_PUBLIC_CHRISTMAS !== 'off';

/** Dias inteiros até o próximo 25 de dezembro (0 = hoje é Natal). */
export function daysUntilChristmas(now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let xmas = new Date(now.getFullYear(), 11, 25);
  if (today.getTime() > xmas.getTime()) xmas = new Date(now.getFullYear() + 1, 11, 25);
  return Math.round((xmas.getTime() - today.getTime()) / 86_400_000);
}
