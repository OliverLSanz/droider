// A stylised DROID master: SD slot, Load button, the 4×4 LED buttons and jacks.
// Drawn at 300×600 and scaled by `height`.
import { theme } from "./theme";

export const MODULE = { width: 300, height: 600 };
/** Where the SD card enters, in module units. */
export const SLOT = { x: 150, y: 92 };

export function Module({
  height,
  leds,
  load = 0,
  slot = 0,
  card = 0,
  shake = 0,
}: {
  height: number;
  /** 16 LEDs: colour and level (0–1), or null when dark. */
  leds: ({ color: string; level: number } | null)[];
  /** 0–1: the Load button pressed. */
  load?: number;
  /** 0–1: glow of the card slot. */
  slot?: number;
  /** 0–1: how far the card sits in the slot (1 = inserted). */
  card?: number;
  shake?: number;
}) {
  const s = height / MODULE.height;
  return (
    <svg
      width={MODULE.width * s}
      height={height}
      viewBox={`0 0 ${MODULE.width} ${MODULE.height}`}
      style={{ overflow: "visible", transform: `translateX(${shake * 4}px)`, filter: "drop-shadow(0 40px 60px #000c)" }}
    >
      <defs>
        <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C212A" />
          <stop offset="1" stopColor="#12151B" />
        </linearGradient>
        <filter id="ledglow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <rect x="0" y="0" width="300" height="600" rx="16" fill="url(#panel)" stroke="#ffffff1c" />
      {[
        [18, 18],
        [282, 18],
        [18, 582],
        [282, 582],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <circle cx={x} cy={y} r="6" fill="#0B0D11" stroke="#ffffff22" />
          <path d={`M${x - 3} ${y}h6`} stroke="#ffffff33" />
        </g>
      ))}
      <text x="150" y="56" textAnchor="middle" fill={theme.text} style={{ font: `700 30px ${theme.sans}`, letterSpacing: "0.12em" }}>
        DROID
      </text>
      <text x="150" y="76" textAnchor="middle" fill={theme.muted} style={{ font: `600 11px ${theme.mono}`, letterSpacing: "0.4em" }}>
        MASTER
      </text>
      {/* SD card slot, and the card sliding in. */}
      <rect x={SLOT.x - 40} y={SLOT.y - 4} width="80" height="8" rx="3" fill="#05070A" stroke={`rgba(56,189,248,${0.25 + slot * 0.75})`} />
      {slot > 0 ? <rect x={SLOT.x - 44} y={SLOT.y - 8} width="88" height="16" rx="6" fill="#38BDF8" opacity={slot * 0.35} filter="url(#ledglow)" /> : null}
      {card > 0 ? (
        <g clipPath="none">
          <rect x={SLOT.x - 30} y={SLOT.y - 4 - 46 * (1 - card)} width="60" height={4 + 46 * (1 - card)} rx="4" fill="#E9EDF3" />
          <rect x={SLOT.x - 30} y={SLOT.y - 4 - 46 * (1 - card)} width="60" height="6" fill={theme.cyan} opacity={card < 1 ? 1 : 0} />
        </g>
      ) : null}
      {/* Load button. */}
      <g transform={`translate(64 140) scale(${1 - load * 0.08})`}>
        <circle r="26" fill="#0B0D11" stroke={load > 0 ? theme.cyan : "#ffffff33"} strokeWidth={1.5 + load * 2} />
        <circle r="18" fill={load > 0 ? "#2A3442" : "#1F2530"} />
      </g>
      <text x="64" y="188" textAnchor="middle" fill={theme.muted} style={{ font: `600 11px ${theme.mono}`, letterSpacing: "0.2em" }}>
        LOAD
      </text>
      {/* Status LEDs. */}
      {Array.from({ length: 6 }, (_, i) => (
        <circle key={i} cx={130 + i * 22} cy={140} r="5" fill={leds[i] ? leds[i]!.color : "#2A313C"} opacity={leds[i] ? 0.35 + 0.65 * leds[i]!.level : 1} />
      ))}
      {/* 4×4 LED buttons. */}
      {leds.map((led, i) => {
        const x = 41 + (i % 4) * 58;
        const y = 214 + Math.floor(i / 4) * 58;
        return (
          <g key={i}>
            <rect x={x} y={y} width="44" height="44" rx="9" fill="#0E1116" stroke="#ffffff1f" />
            {led && led.level > 0.01 ? (
              <>
                <rect x={x + 4} y={y + 4} width="36" height="36" rx="7" fill={led.color} opacity={led.level * 0.9} filter="url(#ledglow)" />
                <rect x={x + 7} y={y + 7} width="30" height="30" rx="6" fill={led.color} opacity={0.25 + 0.75 * led.level} />
              </>
            ) : (
              <rect x={x + 7} y={y + 7} width="30" height="30" rx="6" fill="#1D232C" />
            )}
          </g>
        );
      })}
      {/* Jacks. */}
      {[460, 524].map((y) =>
        [64, 118, 172, 226].map((x) => (
          <g key={`${x}${y}`}>
            <circle cx={x} cy={y} r="17" fill="#D9DEE6" />
            <circle cx={x} cy={y} r="11" fill="#2A313C" />
            <circle cx={x} cy={y} r="6.5" fill="#05070A" />
          </g>
        )),
      )}
    </svg>
  );
}
