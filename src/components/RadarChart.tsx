// 六维能力雷达图 —— 纯 SVG, 不引第三方图表库.
//
// 为什么用小倍数 (一人一张小图) 而不是把八个人叠在一张图上:
// 八条线叠在一起, 颜色区分度和遮挡都会崩. 可视化规范里明确写了, 超过阈值应该
// 拆成小倍数而不是硬塞更多颜色. 一人一张、坐标轴和量程完全一致, 对比的是"形状",
// 一眼就能看出谁是坦克型谁是输出型.
//
// 每根轴都按【这批人里的最大值】归一化, 所以外圈 = 本组第一. 这是相对不是绝对,
// 图上必须写清楚, 否则会被误读成"满分".

export type RadarAxis = { label: string; value: number; max: number; display: string };

export default function RadarChart({
  axes,
  size = 168,
  color = "var(--gold)",
}: {
  axes: RadarAxis[];
  size?: number;
  color?: string;
}) {
  const n = axes.length;
  if (n < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26; // 留出轴标签的位置
  const labelPad = Math.round(size * 0.14); // 轴标签探出画布的那部分

  // 从正上方开始顺时针
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const at = (i: number, ratio: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio] as const;
  };

  const ratios = axes.map((a) => (a.max > 0 ? Math.max(0, Math.min(1, a.value / a.max)) : 0));
  const pts = ratios.map((v, i) => at(i, v)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);

  const rings = [0.25, 0.5, 0.75, 1];

  // viewBox 左右各放宽 labelPad: 轴标签画在 1.22r 处再按 start/end 对齐, 文字会探出
  // size 的边界, 不放宽就会被裁掉 (窄屏上尤其明显).

  return (
    <svg viewBox={`${-labelPad} 0 ${size + labelPad * 2} ${size}`} className="h-auto w-full" role="img">
      {/* 背景环与轴线, 颜色要退到背景里去, 不能和数据抢 */}
      {rings.map((g) => (
        <polygon
          key={g}
          points={axes
            .map((_, i) => at(i, g))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.5}
          className="text-[var(--muted)]/25"
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = at(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-[var(--muted)]/25"
          />
        );
      })}

      {/* 数据: 描边 + 顶点, 不靠填充面积读数 —— 雷达图的面积没有实际含义 */}
      <polygon points={pts.join(" ")} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={2} />
      {ratios.map((v, i) => {
        const [x, y] = at(i, v);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
      })}

      {/* 轴标签 */}
      {axes.map((a, i) => {
        const [x, y] = at(i, 1.22);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return (
          <text
            key={a.label}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-[var(--muted)]"
            style={{ fontSize: 9 }}
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
