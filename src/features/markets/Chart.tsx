import type { Candle } from "@/adapters/http/markets";

/**
 * Charts drawn as plain SVG — no chart library, so nothing is added to the bundle every visitor
 * downloads for two polylines. A chart only ever draws the candles it was given: no smoothing,
 * no interpolation across gaps, no invented last point.
 */

/** The close prices as SVG points inside a `width` × `height` box, `pad` from each edge. */
export function points(series: readonly Candle[], width: number, height: number, pad = 2): string {
  const closes = series.map((c) => c.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const span = hi - lo || 1;
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  return closes
    .map((c, i) => `${(pad + i * step).toFixed(1)},${(height - pad - ((c - lo) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
}

/** Up when the last close is at or above the first open — the colour the line is drawn in. */
export function direction(series: readonly Candle[]): "up" | "down" {
  const first = series[0]!;
  const last = series[series.length - 1]!;
  return last.c >= first.o ? "up" : "down";
}

export function Sparkline({ series, label }: { series: readonly Candle[]; label: string }) {
  if (series.length < 2) return <span className="spark spark--none">no chart</span>;
  return (
    <svg className={`spark spark--${direction(series)}`} viewBox="0 0 90 26" width="90" height="26" role="img" aria-label={label}>
      <polyline points={points(series, 90, 26)} fill="none" strokeWidth="1.5" />
    </svg>
  );
}

export function PriceChart({ series, label, format }: { series: readonly Candle[]; label: string; format: (n: number) => string }) {
  if (series.length < 2) return <p className="dim">No chart: GeckoTerminal returned fewer than two candles for this range.</p>;
  const w = 520;
  const h = 180;
  const line = points(series, w, h, 8);
  const closes = series.map((c) => c.c);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="chart">
      <svg className={`chart__svg chart__svg--${direction(series)}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="none">
        <polygon points={`8,${h - 8} ${line} ${w - 8},${h - 8}`} className="chart__area" />
        <polyline points={line} fill="none" strokeWidth="2" className="chart__line" />
      </svg>
      <figcaption className="chart__axis">
        <span>
          high {format(Math.max(...closes))} · low {format(Math.min(...closes))} · last {format(last.c)}
        </span>
        <span>
          {when(first.t)} → {when(last.t)}
        </span>
      </figcaption>
    </figure>
  );
}

/** "+1.23%" / "−2.82%", or "—" when there is no change to show. */
export function formatChange(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
}
