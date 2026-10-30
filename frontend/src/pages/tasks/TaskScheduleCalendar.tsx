import { useMemo, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
} from "lucide-react";
import type { Entity } from "../../api";
import { statusLabel } from "../../domain";
import { Empty } from "../../components/UI";

export type ScheduleView = "month" | "week" | "day";

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});
const weekDayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  weekday: "short",
});

export function scheduleDateKey(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    datePartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function scheduleTimeLabel(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return timePartsFormatter.format(date);
}

function minutesAt(value: unknown) {
  const formatted = scheduleTimeLabel(value);
  if (!formatted) return undefined;
  const [hour, minute] = formatted.split(":").map(Number);
  return hour * 60 + minute;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function keyFromUtcDate(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(key: string, amount: number) {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromUtcDate(date);
}

function weekStart(key: string) {
  const date = parseDateKey(key);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return keyFromUtcDate(date);
}

function monthStart(key: string) {
  const date = parseDateKey(key);
  date.setUTCDate(1);
  return keyFromUtcDate(date);
}

function dateLabel(key: string) {
  return shortDateFormatter.format(parseDateKey(key));
}

function monthLabel(key: string) {
  const date = parseDateKey(key);
  return `${date.getUTCFullYear()} / ${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(view: ScheduleView, selectedDate: string) {
  if (view === "month") return monthLabel(selectedDate);
  if (view === "day") return selectedDate;
  const start = weekStart(selectedDate);
  return `${start} — ${addDays(start, 6)}`;
}

function monthDays(selectedDate: string) {
  const firstDay = monthStart(selectedDate);
  const first = parseDateKey(firstDay);
  const firstOffset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const weekCount = Math.ceil((firstOffset + daysInMonth) / 7);
  const start = addDays(firstDay, -firstOffset);
  return Array.from({ length: weekCount * 7 }, (_, index) => addDays(start, index));
}

function weekdayLabel(key: string) {
  return weekDayFormatter.format(parseDateKey(key));
}

function taskName(task: Entity) {
  return String(task.title || task.name || "未命名任务");
}

function resourceName(resource: Entity) {
  return String(resource.title || resource.name || "未命名设备");
}

function taskDateAndRange(task: Entity) {
  const start = scheduleDateKey(task.startAt);
  const end = scheduleDateKey(task.endAt);
  return { start, end };
}

function tasksByStart(tasks: Entity[]) {
  return [...tasks].sort((left, right) => {
    const leftTime = new Date(String(left.startAt || "")).getTime();
    const rightTime = new Date(String(right.startAt || "")).getTime();
    return leftTime - rightTime;
  });
}

function placeInLanes(
  tasks: Entity[],
  selectedDate: string,
  rangeStart: number,
  rangeEnd: number,
) {
  const laneEnds: number[] = [];
  return tasksByStart(tasks).flatMap((task) => {
    const startKey = scheduleDateKey(task.startAt);
    const endKey = scheduleDateKey(task.endAt);
    const rawStart = minutesAt(task.startAt);
    const rawEnd = minutesAt(task.endAt);
    if (!startKey || !endKey || rawStart === undefined || rawEnd === undefined)
      return [];

    const start = startKey < selectedDate ? 0 : rawStart;
    const end = endKey > selectedDate ? 24 * 60 : rawEnd;
    const clippedStart = Math.max(start, rangeStart);
    const clippedEnd = Math.min(end, rangeEnd);
    if (clippedEnd <= clippedStart) return [];

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= clippedStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = clippedEnd;
    return [{ task, start: clippedStart, end: clippedEnd, lane }];
  });
}

export function calendarToday() {
  return scheduleDateKey(new Date());
}

export default function TaskScheduleCalendar({
  tasks,
  filters,
  resources,
  resourcesLoading,
  resourcesError,
  selectedDate,
  view,
  fullDay,
  onSelectedDateChange,
  onViewChange,
  onFullDayChange,
  onTaskSelect,
}: {
  tasks: Entity[];
  filters?: ReactNode;
  resources: Entity[];
  resourcesLoading: boolean;
  resourcesError?: Error | null;
  selectedDate: string;
  view: ScheduleView;
  fullDay: boolean;
  onSelectedDateChange: (date: string) => void;
  onViewChange: (view: ScheduleView) => void;
  onFullDayChange: (fullDay: boolean) => void;
  onTaskSelect: (task: Entity) => void;
}) {
  const days = useMemo(() => monthDays(selectedDate), [selectedDate]);
  const scheduledTasks = useMemo(
    () => tasks.filter((task) => !!scheduleDateKey(task.startAt)),
    [tasks],
  );
  const weekDays = useMemo(() => {
    const start = weekStart(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDate]);
  const visibleResources = resources;
  const resourceIds = useMemo(
    () => new Set(visibleResources.map((resource) => resource.id)),
    [visibleResources],
  );
  const unassignedTasks = useMemo(
    () =>
      scheduledTasks.filter((task) => {
        const { start, end } = taskDateAndRange(task);
        const rangeStart = view === "day" ? selectedDate : weekDays[0];
        const rangeEnd = view === "day" ? selectedDate : weekDays[6];
        return (
          end >= rangeStart &&
          start <= rangeEnd &&
          !task.deviceId
        );
      }),
    [scheduledTasks, selectedDate, view, weekDays],
  );
  const inaccessibleResourceTasks = useMemo(
    () =>
      scheduledTasks.filter((task) => {
        const { start, end } = taskDateAndRange(task);
        const rangeStart = view === "day" ? selectedDate : weekDays[0];
        const rangeEnd = view === "day" ? selectedDate : weekDays[6];
        return (
          end >= rangeStart &&
          start <= rangeEnd &&
          !!task.deviceId &&
          !resourceIds.has(String(task.deviceId))
        );
      }),
    [resourceIds, scheduledTasks, selectedDate, view, weekDays],
  );
  const hours = fullDay
    ? Array.from({ length: 24 }, (_, index) => index)
    : Array.from({ length: 11 }, (_, index) => index + 7);
  const rangeStart = fullDay ? 0 : 7 * 60;
  const rangeEnd = fullDay ? 24 * 60 : 18 * 60;
  const today = calendarToday();

  function movePeriod(direction: -1 | 1) {
    if (view === "month") {
      const date = parseDateKey(monthStart(selectedDate));
      date.setUTCMonth(date.getUTCMonth() + direction);
      onSelectedDateChange(keyFromUtcDate(date));
    } else if (view === "week") {
      onSelectedDateChange(addDays(selectedDate, direction * 7));
    } else {
      onSelectedDateChange(addDays(selectedDate, direction));
    }
  }

  function selectEvent(task: Entity) {
    onTaskSelect(task);
  }

  function eventTime(task: Entity) {
    const start = scheduleTimeLabel(task.startAt);
    const end = scheduleTimeLabel(task.endAt);
    return start && end ? `${start}—${end}` : start || "时间未设";
  }

  return (
    <div className={`task-calendar task-calendar-${view}`}>
      <div className="task-calendar-navigation">
        <div className="task-calendar-period">
          <button
            type="button"
            className="task-calendar-icon-button"
            aria-label="上一时段"
            onClick={() => movePeriod(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{periodLabel(view, selectedDate)}</strong>
          <button
            type="button"
            className="task-calendar-icon-button"
            aria-label="下一时段"
            onClick={() => movePeriod(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="task-calendar-today"
            onClick={() => onSelectedDateChange(today)}
          >
            今天
          </button>
        </div>
        <div className="task-calendar-modes" role="group" aria-label="排期视图">
          {(
            [
              ["month", "月历", CalendarDays],
              ["week", "资源周排期", null],
              ["day", "资源日排期", null],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              className={view === id ? "active" : ""}
              aria-pressed={view === id}
              onClick={() => onViewChange(id)}
            >
              {Icon && <Icon size={12} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {filters}

      <div className="task-calendar-summary">
        <span>
          {tasks.length} 条部门任务 · {scheduledTasks.length} 项排期
        </span>
        <span>共享作业合并显示</span>
      </div>

      {view === "month" ? (
        <>
          <div className="task-calendar-month">
            <div className="task-calendar-weekdays" role="row">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
                (day) => (
                  <div role="columnheader" key={day}>
                    {day}
                  </div>
                ),
              )}
            </div>
            <div
              className="task-month-cells"
              role="grid"
              aria-label="月度作业日历"
              style={{
                gridTemplateRows: `repeat(${days.length / 7}, minmax(92px, 1fr))`,
              }}
            >
              {days.map((day) => {
                const currentMonth = day.slice(0, 7) === selectedDate.slice(0, 7);
                const items = tasksByStart(
                  scheduledTasks.filter((task) => scheduleDateKey(task.startAt) === day),
                );
                const dayNumber = String(Number(day.slice(-2)));
                return (
                  <div
                    role="gridcell"
                    key={day}
                    className={`task-month-cell ${currentMonth ? "" : "outside-month"} ${selectedDate === day ? "selected" : ""} ${today === day ? "today" : ""}`}
                  >
                    <button
                      type="button"
                      className="task-month-date"
                      aria-label={day}
                      onClick={() => onSelectedDateChange(day)}
                    >
                      {dayNumber}
                    </button>
                    {items.length > 0 && (
                      <span className="task-month-count">{items.length} 项排期</span>
                    )}
                    <div className="task-month-events">
                      {items.slice(0, 2).map((task) => (
                        <button
                          type="button"
                          key={task.id}
                          className="task-month-event"
                          title={`${eventTime(task)} ${taskName(task)}`}
                          onClick={() => selectEvent(task)}
                        >
                          <span>{scheduleTimeLabel(task.startAt) || "未定时"}</span>
                          <strong>{taskName(task)}</strong>
                        </button>
                      ))}
                      {items.length > 2 && (
                        <button
                          type="button"
                          className="task-month-overflow"
                          onClick={() => {
                            onSelectedDateChange(day);
                            onViewChange("day");
                          }}
                        >
                          还有 {items.length - 2} 项
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="task-calendar-footer">
            <span>
              <CalendarDays size={13} />
              点击日历中的计划查看安排；点击日期后，可切换资源日排期查看占用。
            </span>
            <time>{selectedDate}</time>
          </div>
        </>
      ) : view === "week" ? (
        <>
          <div className="task-week-scroll">
            {resourcesLoading || resourcesError ? (
              <Empty
                loading={resourcesLoading}
                error={resourcesError}
                title="执行资源暂不可用"
                description="恢复设备档案后可查看当前授权范围内的资源排期。"
              />
            ) : (
              <div
                className="task-week-grid"
                style={{
                  gridTemplateColumns: `176px repeat(7, minmax(118px, 1fr))`,
                }}
              >
                <div className="task-week-corner">执行资源</div>
                {weekDays.map((day) => (
                  <button
                    type="button"
                    key={day}
                    className={`task-week-day-heading ${day === selectedDate ? "selected" : ""}`}
                    onClick={() => {
                      onSelectedDateChange(day);
                      onViewChange("day");
                    }}
                  >
                    <span>{weekdayLabel(day)}</span>
                    <strong>{dateLabel(day)}</strong>
                  </button>
                ))}
                {visibleResources.map((resource) => (
                  <div className="task-week-resource-row" key={resource.id}>
                    <div className="task-week-resource">
                      <strong>{resourceName(resource)}</strong>
                      <small>{String(resource.region || "区域未设置")}</small>
                      <span
                        className={`task-resource-state ${resource.status === "ACTIVE" || resource.status === "AVAILABLE" ? "ready" : "attention"}`}
                      >
                        {statusLabel(resource.status)}
                      </span>
                    </div>
                    {weekDays.map((day) => {
                      const items = tasksByStart(
                        scheduledTasks.filter(
                          (task) =>
                            String(task.deviceId || "") === resource.id &&
                            scheduleDateKey(task.startAt) <= day &&
                            scheduleDateKey(task.endAt) >= day,
                        ),
                      );
                      return (
                        <div className="task-week-cell" key={`${resource.id}:${day}`}>
                          {items.map((task) => (
                            <button
                              type="button"
                              className="task-week-event"
                              key={task.id}
                              onClick={() => selectEvent(task)}
                            >
                              <span>{eventTime(task)}</span>
                              <strong>{taskName(task)}</strong>
                              <small>{statusLabel(task.status)}</small>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {!visibleResources.length && (
                  <div className="task-calendar-empty">
                    <Empty
                      title="暂无可查看的执行资源"
                      description="当前筛选范围内没有可见设备档案。"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <UnassignedSchedule
            tasks={unassignedTasks}
            inaccessibleTasks={inaccessibleResourceTasks}
            onTaskSelect={selectEvent}
          />
          <div className="task-calendar-note">
            排期表示计划占用；架次与实际计量以飞行记录为准。
          </div>
          <div className="task-calendar-footer">
            <span>
              <CalendarDays size={13} />
              点击日历中的计划查看安排；点击日期后，可切换资源日排期查看占用。
            </span>
            <time>{selectedDate}</time>
          </div>
        </>
      ) : (
        <>
          <div className="task-day-range">
            <span>
              <Clock3 size={13} /> 显示时间 {fullDay ? "00:00—24:00" : "07:00—18:00"}
            </span>
            <div className="task-calendar-modes" role="group" aria-label="日排期时窗">
              <button
                type="button"
                className={!fullDay ? "active" : ""}
                aria-pressed={!fullDay}
                onClick={() => onFullDayChange(false)}
              >
                任务时段
              </button>
              <button
                type="button"
                className={fullDay ? "active" : ""}
                aria-pressed={fullDay}
                onClick={() => onFullDayChange(true)}
              >
                全天24小时
              </button>
            </div>
          </div>
          <div className="task-day-scroll">
            {resourcesLoading || resourcesError ? (
              <Empty
                loading={resourcesLoading}
                error={resourcesError}
                title="执行资源暂不可用"
                description="恢复设备档案后可查看当前授权范围内的资源排期。"
              />
            ) : (
              <div className="task-day-grid">
                <div
                  className="task-day-axis"
                  style={{ gridTemplateColumns: `176px repeat(${hours.length}, minmax(54px, 1fr))` }}
                >
                  <div>执行资源</div>
                  {hours.map((hour) => (
                    <div key={hour}>{String(hour).padStart(2, "0")}:00</div>
                  ))}
                </div>
                {visibleResources.map((resource) => {
                  const items = scheduledTasks.filter(
                    (task) =>
                      String(task.deviceId || "") === resource.id &&
                      scheduleDateKey(task.startAt) <= selectedDate &&
                      scheduleDateKey(task.endAt) >= selectedDate,
                  );
                  const placed = placeInLanes(
                    items,
                    selectedDate,
                    rangeStart,
                    rangeEnd,
                  );
                  const laneCount = placed.reduce(
                    (maximum, item) => Math.max(maximum, item.lane + 1),
                    0,
                  );
                  return (
                    <div
                      className="task-day-resource-row"
                      key={resource.id}
                      style={{ minHeight: Math.max(76, 22 + laneCount * 48) }}
                    >
                      <div className="task-day-resource">
                        <strong>{resourceName(resource)}</strong>
                        <small>{String(resource.region || "区域未设置")}</small>
                        <span
                          className={`task-resource-state ${resource.status === "ACTIVE" || resource.status === "AVAILABLE" ? "ready" : "attention"}`}
                        >
                          {statusLabel(resource.status)}
                        </span>
                      </div>
                      <div
                        className="task-day-time-cells"
                        style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(54px, 1fr))` }}
                      >
                        {hours.map((hour) => (
                          <span className="task-day-hour-cell" key={hour} />
                        ))}
                        {placed.map(({ task, start, end, lane }) => {
                          const span = rangeEnd - rangeStart;
                          const left = ((start - rangeStart) / span) * 100;
                          const width = ((end - start) / span) * 100;
                          return (
                            <button
                              type="button"
                              key={task.id}
                              className="task-day-event"
                              title={`${eventTime(task)} ${taskName(task)} · ${statusLabel(task.status)}`}
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                top: `${7 + lane * 48}px`,
                              }}
                              onClick={() => selectEvent(task)}
                            >
                              <span>{eventTime(task)}</span>
                              <strong>{taskName(task)}</strong>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {!visibleResources.length && (
                  <div className="task-calendar-empty">
                    <Empty
                      title="暂无可查看的执行资源"
                      description="当前筛选范围内没有可见设备档案。"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <UnassignedSchedule
            tasks={unassignedTasks}
            inaccessibleTasks={inaccessibleResourceTasks}
            onTaskSelect={selectEvent}
          />
          <div className="task-calendar-note">
            排期表示计划占用；架次与实际计量以飞行记录为准。
          </div>
          <div className="task-calendar-footer">
            <span>
              <CalendarDays size={13} />
              点击日历中的计划查看安排；点击日期后，可切换资源日排期查看占用。
            </span>
            <time>{selectedDate}</time>
          </div>
        </>
      )}
    </div>
  );
}

function UnassignedSchedule({
  tasks,
  inaccessibleTasks,
  onTaskSelect,
}: {
  tasks: Entity[];
  inaccessibleTasks: Entity[];
  onTaskSelect: (task: Entity) => void;
}) {
  if (!tasks.length && !inaccessibleTasks.length) return null;
  return (
    <div className="task-unassigned-schedule">
      <strong>待配置资源 {tasks.length}</strong>
      {tasks.map((task) => (
        <button type="button" key={task.id} onClick={() => onTaskSelect(task)}>
          <time>
            {dateLabel(scheduleDateKey(task.startAt))} {scheduleTimeLabel(task.startAt)}
          </time>
          {taskName(task)}
        </button>
      ))}
      {!!inaccessibleTasks.length && (
        <span className="task-unavailable-schedule">
          {inaccessibleTasks.length} 项已分配任务的设备档案当前不可见
        </span>
      )}
    </div>
  );
}
