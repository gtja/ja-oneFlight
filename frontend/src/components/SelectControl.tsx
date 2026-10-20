import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import "./SelectControl.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
  group?: string;
}

export interface SelectControlProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  searchable?: boolean;
  className?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

export function SelectControl({
  value,
  onChange,
  options,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  placeholder = "请选择",
  disabled = false,
  required = false,
  name,
  searchable = options.length >= 8,
  className = "",
}: SelectControlProps) {
  const generatedId = useId();
  const triggerId = id || `select-${generatedId}`;
  const listId = `${triggerId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    width: 220,
    maxHeight: 360,
    above: false,
  });
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return keyword
      ? options.filter((option) =>
          [option.label, option.description, option.group, option.value]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(keyword),
        )
      : options;
  }, [options, query]);
  const activeIndex = filtered.findIndex(
    (option) => option.value === activeValue && !option.disabled,
  );
  const activeId = activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  }

  function openMenu(fromEnd = false) {
    if (disabled) return;
    const enabled = options.filter((option) => !option.disabled);
    const current = enabled.find((option) => option.value === value);
    setActiveValue(
      current?.value ??
        (fromEnd ? enabled.at(-1)?.value : enabled[0]?.value) ??
        null,
    );
    setQuery("");
    setOpen(true);
  }

  function selectOption(option: SelectOption) {
    if (option.disabled || disabled) return;
    onChange(option.value);
    closeMenu(true);
  }

  function moveActive(direction: 1 | -1) {
    const enabled = filtered.filter((option) => !option.disabled);
    if (!enabled.length) return;
    const current = enabled.findIndex((option) => option.value === activeValue);
    const next =
      current < 0
        ? direction === 1
          ? 0
          : enabled.length - 1
        : (current + direction + enabled.length) % enabled.length;
    setActiveValue(enabled[next].value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const fromSearch = event.target === searchRef.current;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab" && open) {
      // The search field is portalled outside its form. Restore the tab anchor
      // before the browser and the parent dialog calculate the next control.
      triggerRef.current?.focus();
      closeMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (open) moveActive(direction);
      else openMenu(direction === -1);
    } else if ((event.key === "Home" || event.key === "End") && open) {
      event.preventDefault();
      const enabled = filtered.filter((option) => !option.disabled);
      setActiveValue(
        (event.key === "Home" ? enabled[0]?.value : enabled.at(-1)?.value) ??
          null,
      );
    } else if (event.key === "Enter" || (event.key === " " && !fromSearch)) {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) selectOption(filtered[activeIndex]);
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition(event?: Event) {
      if (
        event?.target instanceof Node &&
        popupRef.current?.contains(event.target)
      )
        return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      const below = viewportHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const expectedHeight = Math.min(
        360,
        (searchable ? 52 : 0) + Math.max(filtered.length, 1) * 38 + 16,
      );
      const useAbove = below < expectedHeight && above > below;
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
      setPosition({
        top: useAbove ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)),
        width,
        maxHeight: Math.max(80, Math.min(360, useAbove ? above : below)),
        above: useAbove,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updatePosition())
        : undefined;
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer?.disconnect();
    };
  }, [open, searchable, filtered.length]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex < 0) {
      setActiveValue(
        filtered.find((option) => !option.disabled)?.value ?? null,
      );
    }
  }, [open, filtered, activeIndex]);

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeId]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  return (
    <div className={`select-control ${className}`}>
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        className={`select-control__trigger${!selected ? " is-placeholder" : ""}`}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeId : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        data-value={value}
        title={selected?.label || placeholder}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="select-control__value">
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={14}
          className={open ? "is-open" : ""}
          aria-hidden="true"
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className={`select-control__popup${position.above ? " is-above" : ""}`}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            onKeyDown={handleKeyDown}
          >
            {searchable && (
              <div className="select-control__search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  role="searchbox"
                  aria-label={`搜索${ariaLabel || "选项"}`}
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  placeholder="搜索名称、编号或关键词"
                  value={query}
                  autoComplete="off"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveValue(null);
                  }}
                />
                <span>{filtered.length} 项</span>
              </div>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={ariaLabel || "可选项"}
              aria-labelledby={ariaLabelledBy}
              className="select-control__list"
            >
              {filtered.map((option, index) => (
                <div
                  className="select-control__item"
                  key={option.value}
                  role="presentation"
                >
                  {option.group &&
                    (index === 0 ||
                      filtered[index - 1].group !== option.group) && (
                      <div
                        className="select-control__group"
                        role="presentation"
                      >
                        {option.group}
                      </div>
                    )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={Boolean(option.disabled)}
                    data-value={option.value}
                    className={`select-control__option${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}${option.disabled ? " is-disabled" : ""}`}
                    title={[option.label, option.description]
                      .filter(Boolean)
                      .join(" · ")}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (!option.disabled) setActiveValue(option.value);
                    }}
                    onClick={() => selectOption(option)}
                  >
                    <div className="select-control__option-copy">
                      <span className="select-control__option-label">
                        {option.label}
                      </span>
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </div>
                    {option.value === value && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </div>
                </div>
              ))}
              {!filtered.length && (
                <div className="select-control__empty" role="status">
                  <Search size={19} aria-hidden="true" />
                  <strong>{query ? "未找到匹配选项" : "暂无可选项"}</strong>
                  <span>
                    {query
                      ? "请尝试其他名称或关键词"
                      : "数据更新后可在这里选择"}
                  </span>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default SelectControl;
