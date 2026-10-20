import { useId, useState, type KeyboardEvent } from "react";
import "./CommandTaskCharts.css";

const LEFT = 35;
const RIGHT = 610;
const BASELINE = 105;
const PLOT_HEIGHT = 75;
const HOUR_WIDTH = (RIGHT - LEFT) / 23;
const time = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const countLabel = (count: number) => `${count.toLocaleString("zh-CN")} 项任务`;

function Grid({ highest }: { highest: number }) {
  return (
    <g aria-hidden="true">
      {[0, 1, 2].map((step) => (
        <g key={step}>
          <line
            x1={LEFT}
            x2={RIGHT}
            y1={BASELINE - (step * PLOT_HEIGHT) / 2}
            y2={BASELINE - (step * PLOT_HEIGHT) / 2}
            className="command-task-chart-grid"
          />
          <text
            x={23}
            y={BASELINE - (step * PLOT_HEIGHT) / 2 + 4}
            textAnchor="end"
            className="command-task-chart-label"
          >
            {((highest * step) / 2).toLocaleString("zh-CN", {
              maximumFractionDigits: 1,
            })}
          </text>
        </g>
      ))}
    </g>
  );
}

function Tooltip({
  id,
  x,
  label,
  count,
}: {
  id: string;
  x: number;
  label: string;
  count: number;
}) {
  const left = Math.max(5, Math.min(483, x - 76));
  return (
    <g
      id={id}
      role="tooltip"
      className="command-task-chart-tooltip"
      transform={`translate(${left} 5)`}
    >
      <rect width="152" height="64" rx="7" />
      <text x="12" y="17" className="command-task-chart-tooltip-title">
        {label}
      </text>
      <text x="12" y="36" className="command-task-chart-tooltip-count">
        {countLabel(count)}
      </text>
      <text x="12" y="53" className="command-task-chart-tooltip-hint">
        点击查看明细 →
      </text>
    </g>
  );
}

function useChartInteraction<T>(onSelect: (value: T) => void, length: number) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const visible = dismissed ? null : (hovered ?? focused);
  return {
    visible,
    handlers: (index: number, value: T) => ({
      onMouseEnter: () => {
        setHovered(index);
        setDismissed(false);
      },
      onMouseLeave: () => setHovered(null),
      onFocus: () => {
        setFocused(index);
        setDismissed(false);
      },
      onBlur: () => setFocused(null),
      onClick: () => onSelect(value),
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat) onSelect(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDismissed(true);
        } else {
          const next =
            event.key === "ArrowRight"
              ? Math.min(length - 1, index + 1)
              : event.key === "ArrowLeft"
                ? Math.max(0, index - 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? length - 1
                    : null;
          if (next != null) {
            event.preventDefault();
            event.currentTarget.ownerSVGElement
              ?.querySelector<SVGGElement>(`[data-chart-index="${next}"]`)
              ?.focus();
          }
        }
      },
    }),
  };
}

// Horizontal control points keep the curve inside each pair of task counts.
// That rounds the joins without inventing negative values or extra peaks.
function smoothPath(points: { x: number; y: number }[]) {
  return points
    .map((point, index) => {
      if (index === 0) return `M${point.x},${point.y}`;
      const previous = points[index - 1];
      const control = (point.x - previous.x) * 0.4;
      return `C${previous.x + control},${previous.y} ${point.x - control},${point.y} ${point.x},${point.y}`;
    })
    .join(" ");
}

export function HourlyChart({
  values,
  onSelect,
  activeHour,
}: {
  values: number[] | null;
  onSelect: (hour: number) => void;
  activeHour?: number | null;
}) {
  const id = useId().replace(/:/g, "");
  const rows = values?.slice(0, 24) || [];
  const highest = Math.ceil(Math.max(2, ...rows) / 2) * 2;
  const points = rows.map((value, index) => ({
    x: LEFT + index * HOUR_WIDTH,
    y: BASELINE - (value / highest) * PLOT_HEIGHT,
  }));
  const path = smoothPath(points);
  const interaction = useChartInteraction(onSelect, rows.length);
  const visible = interaction.visible;
  const tooltipIndex =
    visible != null && visible < rows.length ? visible : null;
  return (
    <svg
      viewBox="0 0 640 133"
      role="group"
      aria-label="今日任务按计划开始时间分布"
      className="command-task-chart command-hourly-chart"
    >
      <defs>
        <linearGradient
          id={`${id}-fill`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="30"
          x2="0"
          y2={BASELINE}
        >
          <stop offset="0%" stopColor="#65b7d9" stopOpacity=".25" />
          <stop offset="100%" stopColor="#5b9cdd" stopOpacity=".015" />
        </linearGradient>
        <linearGradient
          id={`${id}-line`}
          gradientUnits="userSpaceOnUse"
          x1={LEFT}
          y1="0"
          x2={RIGHT}
          y2="0"
        >
          <stop offset="0%" stopColor="#75b6ed" />
          <stop offset="100%" stopColor="#72d1cf" />
        </linearGradient>
      </defs>
      <Grid highest={highest} />
      {points.length > 0 && (
        <g aria-hidden="true" className="command-task-chart-drawing">
          <path
            d={`${path} L${points[points.length - 1].x},${BASELINE} L${LEFT},${BASELINE} Z`}
            fill={`url(#${id}-fill)`}
          />
          <path
            d={path}
            fill="none"
            stroke={`url(#${id}-line)`}
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {rows.map((value, index) => {
        const point = points[index];
        const selected = index === activeHour;
        const highlighted = index === tooltipIndex;
        return (
          <g
            key={index}
            role="button"
            tabIndex={0}
            aria-label={`${time(index)} · ${countLabel(value)}，查看明细`}
            aria-pressed={selected}
            aria-describedby={highlighted ? `${id}-tooltip` : undefined}
            data-chart-index={index}
            className={`command-task-chart-target${selected ? " is-selected" : ""}${highlighted ? " is-highlighted" : ""}`}
            {...interaction.handlers(index, index)}
          >
            <rect
              x={point.x - HOUR_WIDTH / 2}
              y="5"
              width={HOUR_WIDTH}
              height="126"
              rx="5"
              className="command-task-chart-hit"
            />
            <line
              x1={point.x}
              x2={point.x}
              y1="25"
              y2={BASELINE}
              className="command-task-chart-guide"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r="7"
              className="command-task-chart-halo"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={value ? 3 : 1.8}
              className="command-task-chart-dot"
            >
              <title>{`${time(index)} · ${countLabel(value)}`}</title>
            </circle>
          </g>
        );
      })}
      <g aria-hidden="true">
        {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
          <text
            key={hour}
            x={LEFT + hour * HOUR_WIDTH}
            y="128"
            textAnchor="middle"
            className="command-task-chart-label"
          >
            {time(hour)}
          </text>
        ))}
      </g>
      {rows.length === 0 && (
        <text
          x="320"
          y="66"
          textAnchor="middle"
          className="command-task-chart-empty"
        >
          {values === null ? "任务数据暂不可用" : "今日暂无任务数据"}
        </text>
      )}
      {tooltipIndex != null && (
        <Tooltip
          id={`${id}-tooltip`}
          x={points[tooltipIndex].x}
          label={`${time(tooltipIndex)}–${String(tooltipIndex).padStart(2, "0")}:59`}
          count={rows[tooltipIndex]}
        />
      )}
    </svg>
  );
}

export function RegionalChart({
  items,
  onSelect,
  activeRegion,
}: {
  items: { region: string; count: number }[] | null;
  onSelect: (region: string) => void;
  activeRegion?: string | null;
}) {
  const id = useId().replace(/:/g, "");
  const rows = items || [];
  const highest = Math.ceil(Math.max(2, ...rows.map((item) => item.count)) / 2) * 2;
  const width = (RIGHT - LEFT) / Math.max(1, rows.length);
  const interaction = useChartInteraction(onSelect, rows.length);
  const visible = interaction.visible;
  const tooltipIndex =
    visible != null && visible < rows.length ? visible : null;
  return (
    <svg
      viewBox="0 0 640 133"
      role="group"
      aria-label="今日计划任务区域分布"
      className="command-task-chart command-regional-chart"
    >
      <defs>
        <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#82c9e3" />
          <stop offset="100%" stopColor="#498cce" stopOpacity=".75" />
        </linearGradient>
      </defs>
      <Grid highest={highest} />
      {rows.map((item, index) => {
        const x = LEFT + width * (index + 0.5);
        const height = Math.max(2, (item.count / highest) * PLOT_HEIGHT);
        const selected = item.region === activeRegion;
        const highlighted = index === tooltipIndex;
        const barWidth = Math.min(28, width * 0.45);
        return (
          <g
            key={item.region}
            role="button"
            tabIndex={0}
            aria-label={`${item.region} · ${countLabel(item.count)}，查看明细`}
            aria-pressed={selected}
            aria-describedby={highlighted ? `${id}-tooltip` : undefined}
            data-chart-index={index}
            className={`command-task-chart-target${selected ? " is-selected" : ""}${highlighted ? " is-highlighted" : ""}`}
            {...interaction.handlers(index, item.region)}
          >
            <rect
              x={LEFT + width * index + 3}
              y="5"
              width={Math.max(1, width - 6)}
              height="126"
              rx="6"
              className="command-task-chart-hit"
            />
            <rect
              x={x - barWidth / 2}
              y={BASELINE - PLOT_HEIGHT}
              width={barWidth}
              height={PLOT_HEIGHT}
              rx="4"
              className="command-task-chart-rail"
            />
            <rect
              x={x - barWidth / 2}
              y={BASELINE - height}
              width={barWidth}
              height={height}
              rx={item.count ? 4 : 1}
              fill={`url(#${id}-bar)`}
              className="command-task-chart-bar"
            >
              <title>{`${item.region} · ${countLabel(item.count)}`}</title>
            </rect>
            <text
              x={x}
              y={BASELINE - height - 7}
              textAnchor="middle"
              className="command-task-chart-bar-count"
            >
              {item.count}
            </text>
            <text
              x={x}
              y="128"
              textAnchor="middle"
              className="command-task-chart-label"
            >
              {item.region}
            </text>
          </g>
        );
      })}
      {rows.length === 0 && (
        <text
          x="320"
          y="66"
          textAnchor="middle"
          className="command-task-chart-empty"
        >
          {items === null ? "任务数据暂不可用" : "今日暂无区域任务数据"}
        </text>
      )}
      {tooltipIndex != null && (
        <Tooltip
          id={`${id}-tooltip`}
          x={LEFT + width * (tooltipIndex + 0.5)}
          label={rows[tooltipIndex].region}
          count={rows[tooltipIndex].count}
        />
      )}
    </svg>
  );
}
