/**
 * A minimal inline trend line - no charting library needed for a handful of
 * points. points: [{ value, isAbnormal }], oldest first; the last point is
 * coloured red/green by whether it was abnormal. showValues writes each
 * point's value just above it (red when that value was abnormal).
 */
export default function Sparkline({ points, width = 140, height = 36, showValues = false }) {
  const usable = points.filter((p) => Number.isFinite(Number(p.value)));
  if (usable.length < 2) return null;
  const nums = usable.map((p) => Number(p.value));

  const labelRoom = showValues ? 13 : 0; // space above the line for the value labels
  const w = width, h = height + labelRoom, pad = Math.max(3, Math.round(height / 7));
  const sidePad = showValues ? 12 : pad; // so a label on the first/last point isn't clipped
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const stepX = (w - sidePad * 2) / (nums.length - 1);
  const coords = nums.map((n, i) => [
    sidePad + i * stepX,
    h - pad - ((n - min) / range) * (height - pad * 2),
  ]);
  const lastAbnormal = usable[usable.length - 1].isAbnormal;
  const big = height >= 30;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={coords.map((c) => c.join(',')).join(' ')} fill="none" stroke="#2563eb" strokeWidth={big ? 2 : 1.5} />
      {coords.map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y}
          r={i === coords.length - 1 ? (big ? 3.5 : 2.5) : (big ? 2.5 : 1.6)}
          fill={i === coords.length - 1 ? (lastAbnormal ? '#dc2626' : '#16a34a') : '#94a3b8'}
        />
      ))}
      {showValues && coords.map(([x, y], i) => (
        <text
          key={`v${i}`}
          x={x} y={y - 6}
          textAnchor="middle"
          fontSize="10.5"
          fontWeight={i === coords.length - 1 ? 700 : 600}
          fill={usable[i].isAbnormal ? '#b91c1c' : '#334155'}
        >
          {usable[i].value}
        </text>
      ))}
    </svg>
  );
}
