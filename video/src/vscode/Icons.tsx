// Small stand-ins for the VS Code codicons seen in the screenshots.
import type { CSSProperties, ReactNode } from "react";

const S = ({ size = 16, color = "currentColor", children, style }: { size?: number; color?: string; children: ReactNode; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    {children}
  </svg>
);

type P = { size?: number; color?: string; style?: CSSProperties };

export const Files = (p: P) => (
  <S {...p}>
    <path d="M5 3.5h5.5L13 6v7.5H5z M10.5 3.5V6H13 M3 5.5v9h7" />
  </S>
);
export const Search = (p: P) => (
  <S {...p}>
    <circle cx="9.5" cy="6.5" r="3.6" />
    <path d="M7 9.2 3 13.2" />
  </S>
);
export const Branch = (p: P) => (
  <S {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6 M11.5 7c0 3-7 2-7 4" />
  </S>
);
export const Run = (p: P) => (
  <S {...p}>
    <path d="M5 3l8 5-8 5z" />
    <circle cx="4" cy="12.5" r="2" />
  </S>
);
export const Extensions = (p: P) => (
  <S {...p}>
    <path d="M2.5 6.5h4v4h-4z M6.5 6.5h4v4h-4z M2.5 10.5h4v4h-4z M6.5 10.5h4v4h-4z M9.5 1.8l3 3-3 3-3-3z" />
  </S>
);
export const Account = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <circle cx="8" cy="6.3" r="2.3" />
    <path d="M3.7 12.6c1-2 2.6-2.8 4.3-2.8s3.3.8 4.3 2.8" />
  </S>
);
export const Gear = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v2 M8 12.2v2 M1.8 8h2 M12.2 8h2 M3.6 3.6 5 5 M11 11l1.4 1.4 M3.6 12.4 5 11 M11 5l1.4-1.4" />
  </S>
);
export const Menu = (p: P) => (
  <S {...p}>
    <path d="M3 4.5h10 M3 8h10 M3 11.5h10" />
  </S>
);
export const FileLines = (p: P) => (
  <S {...p}>
    <path d="M4 4.5h8 M4 7h8 M4 9.5h8 M4 12h5" />
  </S>
);
export const Close = (p: P) => (
  <S {...p}>
    <path d="M4.5 4.5l7 7 M11.5 4.5l-7 7" />
  </S>
);
export const ChevronRight = (p: P) => (
  <S {...p}>
    <path d="M6 4l4 4-4 4" />
  </S>
);
export const ChevronDown = (p: P) => (
  <S {...p}>
    <path d="M4 6l4 4 4-4" />
  </S>
);
export const Ellipsis = (p: P) => (
  <S {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </S>
);
export const Split = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M8 2.5v11" />
  </S>
);
/** type-hierarchy: the Circuit Graph button. */
export const Hierarchy = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="3.5" r="1.6" />
    <circle cx="4" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <path d="M8 5.1v2.4 M4 10.4V9h8v1.4 M8 7.5V9" />
  </S>
);
/** circuit-board: the Hardware View button. */
export const Board = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M5.5 5.5h2v2h-2z M10.5 5v3 M5 10.5h3 M10 10.5h.5" />
  </S>
);
/** package: the Build button. */
export const Package = (p: P) => (
  <S {...p}>
    <path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z M2.5 4.8 8 7.8l5.5-3 M8 7.8v6.4 M5.2 3.3l5.6 3" />
  </S>
);
export const CloudUpload = (p: P) => (
  <S {...p}>
    <path d="M4.5 12.5H4a3 3 0 0 1-.2-6A4.3 4.3 0 0 1 12 5.8a3.2 3.2 0 0 1 .3 6.7h-.8" />
    <path d="M8 13.5V8 M6 10l2-2 2 2" />
  </S>
);
export const Disconnect = (p: P) => (
  <S {...p}>
    <path d="M3 13l2.5-2.5 M10.5 5.5 13 3 M5 8.5l2.5 2.5-1.5 1.5a1.8 1.8 0 0 1-2.5-2.5z M11 7.5 8.5 5 10 3.5A1.8 1.8 0 0 1 12.5 6z" />
  </S>
);
export const Bell = (p: P) => (
  <S {...p}>
    <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3z M6.8 13.5a1.3 1.3 0 0 0 2.4 0" />
  </S>
);
export const Remote = (p: P) => (
  <S {...p}>
    <path d="M3 7l3-3 M3 7l3 3 M13 9l-3-3 M13 9l-3 3" />
  </S>
);
export const ErrorIcon = ({ size = 16, color = "#F14C4C", style }: P) => (
  <S size={size} color={color} style={style}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M5.9 5.9l4.2 4.2 M10.1 5.9l-4.2 4.2" />
  </S>
);
export const Warning = (p: P) => (
  <S {...p}>
    <path d="M8 2.5l6 10.5H2z M8 6.5v3 M8 11.2v.1" />
  </S>
);
export const Info = ({ size = 16, color = "#3794FF", style }: P) => (
  <S size={size} color={color} style={style}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 7.3v3.6 M8 5.2v.1" />
  </S>
);
export const Filter = (p: P) => (
  <S {...p}>
    <path d="M2.5 3h11L9.2 8.3v4.5l-2.4 1V8.3z" />
  </S>
);

// ── Suggest widget kinds (codicon symbol-* colours from Dark Modern) ──

export const KIND_COLORS = {
  class: "#EE9D28",
  module: "#CCCCCC",
  field: "#75BEFF",
  property: "#CCCCCC",
  variable: "#75BEFF",
  constant: "#CCCCCC",
} as const;
export type Kind = keyof typeof KIND_COLORS;

export function KindIcon({ kind, size = 16 }: { kind: Kind; size?: number }) {
  const color = KIND_COLORS[kind];
  switch (kind) {
    case "class":
      return (
        <S size={size} color={color}>
          <path d="M2.5 5.5 5 3l2.5 2.5L5 8z M9 9h4.5v4.5H9z M9.5 2.5h4v4h-4z M7.5 5.5h2 M11.3 6.5V9 M5 8v3.3h4" />
        </S>
      );
    case "field":
      return (
        <S size={size} color={color}>
          <path d="M8 2.5l5 2.6v5.8L8 13.5 3 10.9V5.1z M3 5.1l5 2.6 5-2.6 M8 7.7v5.8" />
        </S>
      );
    case "property":
      return (
        <S size={size} color={color}>
          <path d="M10.8 2.6a3 3 0 0 0-3.6 3.9L2.8 10.9a1.4 1.4 0 0 0 2 2l4.4-4.4a3 3 0 0 0 3.9-3.6l-1.9 1.9-1.6-.4-.4-1.6z" />
        </S>
      );
    case "variable":
      return (
        <S size={size} color={color}>
          <path d="M4.5 4H3v8h1.5 M11.5 4H13v8h-1.5 M6 6l4 4 M10 6l-4 4" />
        </S>
      );
    case "constant":
      return (
        <S size={size} color={color}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
          <path d="M5 6.5h6 M5 9.5h6" />
        </S>
      );
    default:
      return (
        <S size={size} color={color}>
          <path d="M6 2.5H5a1.5 1.5 0 0 0-1.5 1.5v2.2L2.5 8l1 1.8V12A1.5 1.5 0 0 0 5 13.5h1 M10 2.5h1A1.5 1.5 0 0 1 12.5 4v2.2l1 1.8-1 1.8V12a1.5 1.5 0 0 1-1.5 1.5h-1" />
        </S>
      );
  }
}
