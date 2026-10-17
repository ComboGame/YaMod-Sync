import { useMemo } from "react";

/**
 * Знак мода: звезда-вспышка, как на иконке приложения, но в акценте темы.
 * Лучи разной длины — как у звезды Яндекс Музыки, от которой мод вырос.
 */
export function BrandMark({ className }: { className?: string }) {
  const points = useMemo(() => {
    const rays = 12;
    const lengths = [1, 0.62, 0.86, 0.7, 0.95, 0.58, 0.9, 0.66, 1, 0.6, 0.8, 0.72];
    const out: string[] = [];
    for (let i = 0; i < rays * 2; i++) {
      const angle = (Math.PI * i) / rays - Math.PI / 2;
      const r = i % 2 === 0 ? 11.5 * lengths[i / 2]! : 3.6;
      out.push(`${(12 + Math.cos(angle) * r).toFixed(2)},${(12 + Math.sin(angle) * r).toFixed(2)}`);
    }
    return out.join(" ");
  }, []);
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <polygon points={points} fill="var(--ms-brand)" />
    </svg>
  );
}
