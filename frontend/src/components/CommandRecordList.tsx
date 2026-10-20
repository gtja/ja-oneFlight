import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Inbox,
  MapPin,
  Route,
  ShieldAlert,
} from "lucide-react";
import type { Entity } from "../api";
import { entityName } from "../api";
import { statusLabel } from "../domain";
import { Button, Modal, SearchBox, Status } from "./UI";

export type CommandRecordGroup = {
  title: string;
  items: Entity[] | undefined;
  kind: "map" | "task" | "plan" | "case";
  note: string;
  destination: string;
  destinationLabel: string;
  metric?: (item: Entity) => string;
};

export default function CommandRecordList({
  group,
  region,
  loading,
  error,
  caption,
  status,
  onSelect,
  onClose,
  onNavigate,
}: {
  group: CommandRecordGroup;
  region: string;
  loading: boolean;
  error: boolean;
  caption: (item: Entity) => string;
  status: (item: Entity) => string | undefined;
  onSelect: (item: Entity) => void;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const query = keyword.trim().toLocaleLowerCase();
  const items = group.items?.filter(
    (item) =>
      !query ||
      [
        entityName(item),
        item.region,
        item.scene,
        item.sn,
        statusLabel(status(item)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
  );
  const RowIcon =
    group.kind === "task"
      ? Clock3
      : group.kind === "plan"
        ? Route
        : group.kind === "case"
          ? ShieldAlert
          : MapPin;
  return (
    <Modal
      title={`${group.title}明细`}
      className="command-task-dialog command-record-dialog"
      wide
      onClose={onClose}
    >
      <div className="command-record-summary">
        <div>
          <span>{region || "全市"} · 当前授权范围</span>
          <p>{group.note}</p>
        </div>
        <strong>
          {group.items?.length ?? "—"}
          <small> 项</small>
        </strong>
      </div>
      {group.items && group.items.length > 8 && (
        <div className="command-record-search">
          <SearchBox
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索名称、区域或状态"
          />
          <span>
            {items?.length} / {group.items.length} 项
          </span>
        </div>
      )}
      {items?.length ? (
        <ul className="command-record-list" aria-label={`${group.title}列表`}>
          {items.map((item) => (
            <li key={item.id}>
              <button onClick={() => onSelect(item)}>
                <span className="command-record-icon">
                  <RowIcon size={17} />
                </span>
                <span className="command-record-copy">
                  <strong>{entityName(item)}</strong>
                  <small>{caption(item)}</small>
                </span>
                {group.metric && (
                  <span className="command-record-metric">
                    {group.metric(item)}
                  </span>
                )}
                <Status status={status(item)} />
                <ChevronRight size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="command-record-empty command-drilldown-empty"
          role="status"
        >
          <Inbox size={28} />
          <strong>
            {query
              ? "未找到匹配记录"
              : error
                ? "数据暂不可用"
                : loading
                  ? "正在同步数据…"
                  : "当前范围暂无记录"}
          </strong>
          <span>
            {query
              ? "可调整关键词或清空搜索"
              : error
                ? "可在数据保障中重试同步"
                : loading
                  ? "同步完成后会自动显示"
                  : "可切换区域或查看其他指标"}
          </span>
        </div>
      )}
      <div className="command-record-footer">
        <span>
          {group.kind === "map"
            ? "点击对象，在地图中定位并查看详情"
            : "点击记录查看详情"}
        </span>
        <Button small onClick={onNavigate}>
          {group.destinationLabel}
          <ArrowRight size={13} />
        </Button>
      </div>
    </Modal>
  );
}
