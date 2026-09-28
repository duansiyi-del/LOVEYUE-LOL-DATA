// 按时间走势的折线图 (纯 SVG, 不引图表库).
//
// 只画一条线. 胜率 (0~1) 和评分 (0~10) 量纲不同, 想同时看就画两张同样坐标的小图,
// 绝不画双轴 —— 双轴的两条线可以靠调刻度摆出任意想要的"关系", 是最容易骗人的图.
//
// 样本少的点画成空心: 一个月只打了三场的胜率不该和打了四十场的点看起来一样重.

export type TrendPoint = {
  /** x 轴标签, 比如 "2026-03" */
  label: string;
  /** 没有值的月份传 null, 线会断开而不是插值 —— 插值等于编数据 */
  value: number | null;
  /** 样本量, 用来决定实心还是空心 */
  n: number;
};

export default function TrendChart({
  points,
  min,
  max,
  format,
  minN = 5,
  baseline,
  baselineLabel,
}: {
  points: TrendPoint[];
  min: number;
  max: number;
  format: (v: number) => string;
  /** 低于这个场次的点画空心 */
  minN?: number;
  /** 可选的参照线, 比如总体平均 */
  baseline?: number;
  baselineLabel?: string;
}) {
  if (points.length < 2) return null;

  const w = 640;
  const h = 200;
  const padL = 46;
  const padR = 16;
  const padT = 14;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const x = (i: number) => padL + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => padT + plotH - ((v - min) / (max - min || 1)) * plotH;

  // 只在有值的点之间连线; 中间缺的月份让线断开
  const segs: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else {
      cur.push({ i, v: p.value });
    }
  });
  if (cur.length) segs.push(cur);

  const ticks = [min, (min + max) / 2, max];
  // x 轴标签太密就隔几个画一个
  const step = Math.ceil(points.length / 8);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            y1={y(t)}
            x2={w - padR}
            y2={y(t)}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-[var(--muted)]/20"
          />
          <text
            x={padL - 8}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 9 }}
          >
            {format(t)}
          </text>
        </g>
      ))}

      {baseline !== undefined ? (
        <>
          <line
            x1={padL}
            y1={y(baseline)}
            x2={w - padR}
            y2={y(baseline)}
            stroke="var(--gold)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          {baselineLabel ? (
            <text
              x={w - padR}
              y={y(baseline) - 4}
              textAnchor="end"
              className="fill-[var(--muted)]"
              style={{ fontSize: 9 }}
            >
              {baselineLabel}
            </text>
          ) : null}
        </>
      ) : null}

      {segs.map((seg, k) => (
        <polyline
          key={k}
          points={seg.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {points.map((p, i) =>
        p.value === null ? null : (
          <circle
            key={p.label}
            cx={x(i)}
            cy={y(p.value)}
            r={4}
            fill={p.n >= minN ? "var(--gold)" : "var(--bg-panel)"}
            stroke="var(--gold)"
            strokeWidth={2}
          >
            <title>{`${p.label} · ${format(p.value)} · ${p.n} 场`}</title>
          </circle>
        )
      )}

      {points.map((p, i) =>
        i % step === 0 || i === points.length - 1 ? (
          <text
            key={`t-${p.label}`}
            x={x(i)}
            y={h - 10}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 9 }}
          >
            {p.label.slice(2)}
          </text>
        ) : null
      )}
    </svg>
  );
}
