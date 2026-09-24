// 胜率 + 95% 置信区间的点线图 (误差棒). 纯 SVG.
//
// 为什么换掉原来的文字区间: 「43% 30%~56%」这种写法要读者自己在脑子里比对两行
// 数字有没有重叠, 很难. 画成误差棒之后, 区间是否重叠一眼就能看出来 —— 而这正是
// 本页最重要的一句话: 区间重叠的差异说明不了问题.
//
// 一条虚线标出总体均值, 区间跨过这条线就说明这一组和整体没有可辨别的差异.

export type IntervalRow = {
  label: string;
  /** 右侧补充信息, 比如「12 场」 */
  note?: string;
  rate: number; // 0~1
  lo: number;
  hi: number;
  /** 区间是否跨过参照线 —— 跨过就用灰色, 不给人"有差异"的暗示 */
  inconclusive: boolean;
};

export default function IntervalChart({
  rows,
  baseline,
  baselineLabel = "整体",
}: {
  rows: IntervalRow[];
  baseline: number;
  baselineLabel?: string;
}) {
  if (!rows.length) return null;

  // note 放在左侧标签下面另起一行, 不和右侧的数字抢位置 ——
  // 一开始两者都靠右, 「37%」和「7 场」直接叠在一起了.
  const rowH = 34;
  const padL = 150;
  const padR = 56;
  const padT = 20;
  const w = 560;
  const h = padT + rows.length * rowH + 10;
  const plotW = w - padL - padR;
  const x = (v: number) => padL + v * plotW;

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img">
      {/* 刻度, 退到背景 */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            y1={padT - 6}
            x2={x(t)}
            y2={h - 8}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-[var(--muted)]/20"
          />
          <text
            x={x(t)}
            y={padT - 10}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 9 }}
          >
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}

      {/* 参照线 */}
      <line
        x1={x(baseline)}
        y1={padT - 6}
        x2={x(baseline)}
        y2={h - 8}
        stroke="var(--gold)"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.6}
      />
      <text
        x={x(baseline)}
        y={h - 1}
        textAnchor="middle"
        className="fill-[var(--muted)]"
        style={{ fontSize: 9 }}
      >
        {baselineLabel} {Math.round(baseline * 100)}%
      </text>

      {rows.map((r, i) => {
        const y = padT + i * rowH + rowH / 2;
        const tone = r.inconclusive ? "var(--muted)" : "var(--gold)";
        return (
          <g key={r.label}>
            <text
              x={padL - 12}
              y={r.note ? y - 5 : y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-[var(--foreground)]"
              style={{ fontSize: 11 }}
            >
              {r.label}
            </text>
            {r.note ? (
              <text
                x={padL - 12}
                y={y + 7}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[var(--muted)]"
                style={{ fontSize: 9 }}
              >
                {r.note}
              </text>
            ) : null}
            {/* 误差棒 */}
            <line
              x1={x(r.lo)}
              y1={y}
              x2={x(r.hi)}
              y2={y}
              stroke={tone}
              strokeWidth={2}
              opacity={r.inconclusive ? 0.5 : 0.8}
              strokeLinecap="round"
            />
            {[r.lo, r.hi].map((v, k) => (
              <line
                key={k}
                x1={x(v)}
                y1={y - 4}
                x2={x(v)}
                y2={y + 4}
                stroke={tone}
                strokeWidth={1.5}
                opacity={r.inconclusive ? 0.5 : 0.8}
              />
            ))}
            {/* 点估计: 加一圈底色描边, 压在误差棒上也能看清 */}
            <circle cx={x(r.rate)} cy={y} r={4.5} fill={tone} stroke="var(--bg-panel)" strokeWidth={2} />
            <text
              x={w - padR + 10}
              y={y}
              dominantBaseline="middle"
              className="fill-[var(--foreground)]"
              style={{ fontSize: 11 }}
            >
              {Math.round(r.rate * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
