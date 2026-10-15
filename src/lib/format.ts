import { formatDate } from "../../shared/periods.ts";
import type { DerivedMetrics, TrendLabel } from "../../shared/types.ts";

export function formatValue(value: number, unit: string, decimals: number): string {
  const n = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (unit.startsWith("%")) return `${n}${unit}`;
  if (unit === "index") return n;
  return `${n} ${unit}`;
}

export function ordinal(n: number): string {
  const r = Math.round(n);
  const mod100 = r % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${r}th`;
  return `${r}${["th", "st", "nd", "rd"][r % 10] ?? "th"}`;
}

/** "High (89th percentile since 2006)" */
export function percentilePhrase(d: DerivedMetrics): string | null {
  if (d.percentile === null || !d.band || !d.window_start) return null;
  return `${d.band} (${ordinal(d.percentile)} percentile since ${d.window_start.slice(0, 4)})`;
}

export const TREND_ARROW: Record<TrendLabel, string> = { rising: "↑", falling: "↓", flat: "→" };

export function relativeTime(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** "15 Oct 2026, 06:04 UTC" */
export function formatTimestamp(iso: string): string {
  return `${formatDate(iso)}, ${iso.slice(11, 16)} UTC`;
}
