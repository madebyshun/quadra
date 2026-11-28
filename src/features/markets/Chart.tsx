import { useState, type MouseEvent } from "react";
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

export type ChartStyle = "candles" | "line";

/**
 * Platinum pro OHLCV candlestick & line chart: right-side Y-axis scale, live current-price
 * reference pill, volume histogram, top OHLCV readout, and interactive hover crosshair.
 */
export function CandleChart({
  series,
  label,
  title,
  format,
  style = "candles",
}: {
  series: readonly Candle[];
  label: string;
  title?: string;
  format: (n: number) => string;
  style?: ChartStyle;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (series.length < 2) return <p className="dim">No chart: fewer than two candles for this range.</p>;

  const W = 640;
  const H = 268;
  const padL = 10;
  const padT = 14;
  const axisR = 84;
  const axisB = 24;
  const plotW = W - padL - axisR;
  const plotH = H - padT - axisB;
  const volH = 44;
  const priceH = plotH - volH - 8;

  const rawMin = Math.min(...series.map((c) => c.l));
  const rawMax = Math.max(...series.map((c) => c.h));
  const padSpan = (rawMax - rawMin) * 0.08 || rawMax * 0.02 || 1;
  const lo = Math.max(0, rawMin - padSpan);
  const hi = rawMax + padSpan;
  const span = hi - lo;

  const maxVol = Math.max(0, ...series.map((c) => c.v ?? 0));
  const yOf = (price: number) => padT + priceH - ((price - lo) / span) * priceH;
  const stepX = plotW / series.length;
  const xOf = (i: number) => padL + (i + 0.5) * stepX;
  const bodyW = Math.max(2.5, Math.min(11, stepX * 0.62));

  const last = series[series.length - 1]!;
  const active = hoverIdx !== null && series[hoverIdx] ? series[hoverIdx]! : last;
  const pct = active.o > 0 ? ((active.c - active.o) / active.o) * 100 : 0;
  const isUp = active.c >= active.o;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const val = lo + (1 - f) * span;
    return { y: padT + f * priceH, text: format(val) };
  });

  const xCount = Math.min(5, series.length);
  const xTicks = Array.from({ length: xCount }, (_, k) => {
    const idx = Math.round((k * (series.length - 1)) / Math.max(1, xCount - 1));
    const c = series[idx]!;
    const d = new Date(c.t);
    const spanMs = last.t - series[0]!.t;
    const text =
      spanMs > 86_400_000 * 2
        ? d.toLocaleDateString([], { month: "short", day: "numeric" })
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return { x: xOf(idx), text };
  });

  const linePts = series.map((c, i) => `${xOf(i).toFixed(1)},${yOf(c.c).toFixed(1)}`).join(" ");
  const lastY = yOf(last.c);
  const activeY = yOf(active.c);
  const activeX = hoverIdx !== null ? xOf(hoverIdx) : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W - padL;
    if (relX < 0 || relX > plotW) return setHoverIdx(null);
    const idx = Math.max(0, Math.min(series.length - 1, Math.floor(relX / stepX)));
    setHoverIdx(idx);
  };

  return (
    <figure className="qchart">
      <div className="qchart__hud">
        {title ? <span className="qchart__title">{title}</span> : null}
        <span className="qchart__ohlc mono">
          <span>O {format(active.o)}</span>
          <span>H {format(active.h)}</span>
          <span>L {format(active.l)}</span>
          <span>C {format(active.c)}</span>
          <strong className={isUp ? "up" : "down"}>{formatChange(pct)}</strong>
        </span>
      </div>
      <svg
        className="qchart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Plot background & right Y-axis divider */}
        <rect x={padL} y={padT} width={plotW} height={plotH} fill="#fffdf6" />
        <line x1={padL + plotW} y1={padT} x2={padL + plotW} y2={padT + plotH} stroke="#d4cfc3" strokeWidth="1" />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#d4cfc3" strokeWidth="1" />

        {/* Horizontal gridlines + Y-axis ticks */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={padL + plotW} y2={t.y} stroke="#ebe6da" strokeWidth="1" strokeDasharray="3 3" />
            <text x={padL + plotW + 6} y={t.y + 3.5} className="qchart__tick">
              {t.text}
            </text>
          </g>
        ))}

        {/* Volume histogram along the bottom */}
        {maxVol > 0
          ? series.map((c, i) => {
              const v = c.v ?? 0;
              if (v <= 0) return null;
              const vh = Math.max(2, (v / maxVol) * volH);
              const vy = padT + plotH - vh;
              const up = c.c >= c.o;
              return (
                <rect
                  key={`v-${i}`}
                  x={xOf(i) - bodyW / 2}
                  y={vy}
                  width={bodyW}
                  height={vh}
                  fill={up ? "rgba(15, 122, 77, 0.28)" : "rgba(194, 42, 42, 0.28)"}
                />
              );
            })
          : null}

        {/* Candles or Line */}
        {style === "candles" ? (
          series.map((c, i) => {
            const cx = xOf(i);
            const yH = yOf(c.h);
            const yL = yOf(c.l);
            const yO = yOf(c.o);
            const yC = yOf(c.c);
            const top = Math.min(yO, yC);
            const h = Math.max(2, Math.abs(yC - yO));
            const color = c.c >= c.o ? "#0f7a4d" : "#c22a2a";
            return (
              <g key={`c-${i}`}>
                <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={color} strokeWidth="1.25" />
                <rect x={cx - bodyW / 2} y={top} width={bodyW} height={h} fill={color} />
              </g>
            );
          })
        ) : (
          <g>
            <polygon
              points={`${xOf(0).toFixed(1)},${(padT + priceH).toFixed(1)} ${linePts} ${xOf(series.length - 1).toFixed(1)},${(padT + priceH).toFixed(1)}`}
              fill={direction(series) === "up" ? "rgba(15, 122, 77, 0.12)" : "rgba(194, 42, 42, 0.12)"}
            />
            <polyline
              points={linePts}
              fill="none"
              stroke={direction(series) === "up" ? "#0f7a4d" : "#c22a2a"}
              strokeWidth="2"
            />
          </g>
        )}

        {/* Current price dashed reference line + right Y-axis badge */}
        <line
          x1={padL}
          y1={lastY}
          x2={padL + plotW}
          y2={lastY}
          stroke={last.c >= series[0]!.o ? "#0f7a4d" : "#c22a2a"}
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <rect
          x={padL + plotW + 2}
          y={lastY - 9}
          width={axisR - 4}
          height={18}
          fill={last.c >= series[0]!.o ? "#0f7a4d" : "#c22a2a"}
        />
        <text x={padL + plotW + 6} y={lastY + 3.5} className="qchart__pill-text">
          {format(last.c)}
        </text>

        {/* Interactive hover crosshair */}
        {activeX !== null ? (
          <g>
            <line x1={activeX} y1={padT} x2={activeX} y2={padT + plotH} stroke="#0a3dff" strokeWidth="1" strokeDasharray="3 3" />
            <line x1={padL} y1={activeY} x2={padL + plotW} y2={activeY} stroke="#0a3dff" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={activeX} cy={activeY} r="3.5" fill="#0a3dff" stroke="#fffdf6" strokeWidth="1.5" />
            <rect x={padL + plotW + 2} y={activeY - 9} width={axisR - 4} height={18} fill="#0a3dff" />
            <text x={padL + plotW + 6} y={activeY + 3.5} className="qchart__pill-text">
              {format(active.c)}
            </text>
          </g>
        ) : null}

        {/* X-axis timestamps */}
        {xTicks.map((t, i) => (
          <text key={`x-${i}`} x={t.x} y={H - 7} textAnchor="middle" className="qchart__tick">
            {t.text}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** "+1.23%" / "−2.82%", or "—" when there is no change to show. */
export function formatChange(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
}
