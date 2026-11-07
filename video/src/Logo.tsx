// The Droider icon (media/icon.svg) as a component, so its LEDs can play along.
import { useId } from "react";

const POS = [68, 108, 148, 188];
/** The four LEDs that are always lit in the icon: index → colour. */
export const ICON_LEDS: Record<number, string> = { 0: "#38BDF8", 6: "#34D399", 9: "#FBBF24", 15: "#F472B6" };

export function Logo({ size, extra = {}, cable = 1 }: { size: number; extra?: Record<number, { color: string; level: number }>; cable?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1B2029" />
          <stop offset="1" stopColor="#0B0D11" />
        </linearGradient>
        <linearGradient id={`cable${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="0.5" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#F472B6" />
        </linearGradient>
        <filter id={`glow${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#bg${id})`} />
      <rect x="8.5" y="8.5" width="239" height="239" rx="55.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" />
      {POS.flatMap((y, r) => POS.map((x, c) => <circle key={`${r}${c}`} cx={x} cy={y} r="13" fill="#2A313C" />))}
      <g filter={`url(#glow${id})`}>
        {Object.entries(ICON_LEDS).map(([i, color]) => (
          <circle key={i} cx={POS[Number(i) % 4]} cy={POS[Math.floor(Number(i) / 4)]} r="13" fill={color} />
        ))}
        {Object.entries(extra).map(([i, { color, level }]) =>
          level > 0.01 ? <circle key={`x${i}`} cx={POS[Number(i) % 4]} cy={POS[Math.floor(Number(i) / 4)]} r="13" fill={color} opacity={level} /> : null,
        )}
      </g>
      <path
        d="M68 68 C 68 150, 188 100, 188 188"
        fill="none"
        stroke={`url(#cable${id})`}
        strokeWidth="11"
        strokeLinecap="round"
        filter={`url(#glow${id})`}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - cable}
      />
      <circle cx="68" cy="68" r="7" fill="#0B0D11" />
      <circle cx="188" cy="188" r="7" fill="#0B0D11" opacity={cable > 0.98 ? 1 : 0} />
    </svg>
  );
}
