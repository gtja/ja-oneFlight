import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import GeometryInput from "./GeometryInput";
import SelectControl, { type SelectOption } from "./SelectControl";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Inbox,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type { Entity, Page } from "../api";
import { statusLabel, toInstant, localInput } from "../domain";
export function Status({ status, label }: { status?: string; label?: string }) {
  const tone = [
    "COMPLETED",
    "APPROVED",
    "AVAILABLE",
    "ACTIVE",
    "ONLINE",
    "ARCHIVED",
    "HEALTHY",
    "CONNECTED",
    "SUCCESS",
  ].includes(status || "")
    ? "success"
    : ["CANCELLED", "ERROR", "OFFLINE", "DISCONNECTED"].includes(status || "")
      ? "danger"
      : [
            "RETURNED",
            "MAINTENANCE",
            "PENDING_REVIEW",
            "PENDING_DISPOSAL",
            "STALE",
          ].includes(status || "")
        ? "warning"
        : "neutral";
  return (
    <span className={`status ${tone}`}>
      <i />
      {label || statusLabel(status)}
    </span>
  );
}
export function Button({
  children,
  primary = false,
  small = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  small?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={`button ${primary ? "primary" : ""} ${small ? "small" : ""} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}
export function Empty({
  title = "暂无记录",
  description = "新增业务后，记录将出现在这里。",
  error,
  loading = false,
}: {
  title?: string;
  description?: string;
  error?: Error | null;
  loading?: boolean;
}) {
  return (
    <div className={`empty ${error ? "error" : ""}`}>
      {loading ? (
        <LoaderCircle className="spin" size={28} />
      ) : error ? (
        <AlertCircle size={28} />
      ) : (
        <Inbox size={30} />
      )}
      <strong>{loading ? "正在加载…" : error ? "数据暂不可用" : title}</strong>
      <p>{error?.message || description}</p>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索名称或编号",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function Select({
  value,
  onChange,
  options,
  label,
  disabled,
  searchable,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | SelectOption)[];
  label?: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  return (
    <SelectControl
      className="select-filter"
      aria-label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      searchable={searchable}
      options={options.map((option) =>
        typeof option === "string" ? { value: option, label: option } : option,
      )}
    />
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? "active" : ""}
          key={t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const f = (e: KeyboardEvent) => {
      if (
        Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !==
        dialog.current
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ) || [],
        ).filter((node) => node.getBoundingClientRect().width > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", f);
    return () => {
      document.removeEventListener("keydown", f);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
export type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: SelectOption[];
  wide?: boolean;
  placeholder?: string;
  geometryMode?: "ROUTE" | "AIRSPACE";
};
export function EntityForm({
  fields,
  initial = {},
  onSubmit,
  submitLabel = "保存",
  onCancel,
  notice,
}: {
  fields: Field[];
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<unknown>;
  submitLabel?: string;
  onCancel: () => void;
  notice?: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v = { ...initial };
    fields.forEach((f) => {
      if (f.type === "datetime-local" && v[f.key])
        v[f.key] = localInput(v[f.key]);
    });
    return v;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      for (const field of fields.filter((field) => field.options)) {
        const value = String(values[field.key] ?? "");
        const option = field.options?.find((item) => item.value === value);
        if (field.required && (!value || !option || option.disabled)) {
          document.getElementById(`field-${field.key}`)?.focus();
          throw new Error(`请选择${field.label}`);
        }
      }
      setBusy(true);
      const data = { ...values };
      fields.forEach((f) => {
        if (f.type === "geometry" && f.required && !values[f.key])
          throw new Error(`请先绘制${f.label}`);
        if (f.type === "number")
          data[f.key] =
            values[f.key] === "" || values[f.key] === undefined
              ? null
              : Number(values[f.key]);
        if (f.type === "datetime-local")
          data[f.key] = toInstant(String(values[f.key] || ""));
      });
      await onSubmit(data);
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className={
        fields.some((field) => field.type === "geometry")
          ? "spatial-resource-form"
          : undefined
      }
    >
      {notice && <div className="notice">{notice}</div>}
      <div className="form-grid">
        {fields.map((f) => (
          <div
            key={f.key}
            className={`field ${f.wide ? "wide" : ""} ${f.type === "geometry" ? "spatial-field" : ""}`}
          >
            <label htmlFor={`field-${f.key}`}>
              {f.label}
              {f.required && <em>*</em>}
            </label>
            {f.type === "geometry" ? (
              <GeometryInput
                value={values[f.key]}
                context={values[`${f.key}Context`]}
                mode={f.geometryMode || "AIRSPACE"}
                onChange={(geometry) =>
                  setValues((previous) => ({ ...previous, [f.key]: geometry }))
                }
                onContextChange={(context) =>
                  setValues((previous) => ({
                    ...previous,
                    [`${f.key}Context`]: context,
                  }))
                }
              />
            ) : f.options ? (
              <SelectControl
                className="select-field"
                id={`field-${f.key}`}
                required={f.required}
                disabled={busy}
                placeholder="请选择"
                value={String(values[f.key] ?? "")}
                onChange={(value) => setValues({ ...values, [f.key]: value })}
                options={[{ value: "", label: "请选择" }, ...f.options]}
              />
            ) : f.type === "textarea" ? (
              <textarea
                id={`field-${f.key}`}
                required={f.required}
                value={String(values[f.key] ?? "")}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
                placeholder={f.placeholder}
                rows={4}
              />
            ) : (
              <input
                id={`field-${f.key}`}
                required={f.required}
                type={f.type || "text"}
                value={String(values[f.key] ?? "")}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
                placeholder={f.placeholder}
                min={
                  f.type === "number" &&
                  !["longitude", "latitude"].includes(f.key)
                    ? 0
                    : undefined
                }
              />
            )}
          </div>
        ))}
      </div>
      {error && (
        <p className="form-error">
          <AlertCircle size={14} />
          {error}
        </p>
      )}
      <footer className="form-footer">
        <Button type="button" onClick={onCancel}>
          取消
        </Button>
        <Button primary type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}{" "}
          {submitLabel}
        </Button>
      </footer>
    </form>
  );
}
export function DataTable({
  columns,
  rows,
  onRow,
  loading,
  error,
  emptyTitle,
  emptyDescription,
}: {
  columns: {
    key: string;
    label: string;
    render?: (row: Entity) => ReactNode;
  }[];
  rows: Entity[];
  onRow?: (row: Entity) => void;
  loading?: boolean;
  error?: Error | null;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr
              key={r.id || String(r.deviceId) || index}
              onClick={() => onRow?.(r)}
              className={onRow ? "clickable" : ""}
            >
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          loading={loading}
          error={error}
          title={emptyTitle}
          description={emptyDescription}
        />
      )}
    </div>
  );
}
export function Details({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="details">
      {items.map((i, index) => (
        <div key={index}>
          <dt>{i.label}</dt>
          <dd>{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ListFooter({
  page,
  onChange,
}: {
  page?: Page;
  onChange?: (page: number) => void;
}) {
  return (
    <div className="list-footer">
      当前结果 {page?.total ?? "—"} 条
      {page && onChange && page.total > page.pageSize ? (
        <span>
          <Button
            small
            disabled={page.page <= 1}
            onClick={() => onChange(page.page - 1)}
          >
            上一页
          </Button>
          {page.page} / {Math.ceil(page.total / page.pageSize)}
          <Button
            small
            disabled={page.page >= Math.ceil(page.total / page.pageSize)}
            onClick={() => onChange(page.page + 1)}
          >
            下一页
          </Button>
        </span>
      ) : (
        <span>
          点击记录查看完整档案 <ArrowRight size={12} />
        </span>
      )}
    </div>
  );
}
export function Unavailable({
  title = "此能力尚未接入",
  description = "真实来源接通后将启用对应功能。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="unavailable">
      <AlertCircle size={16} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <span className="label-tag">未接入</span>
    </div>
  );
}
