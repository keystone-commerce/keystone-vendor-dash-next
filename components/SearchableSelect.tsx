import { useEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string };
type OptionInput = string | Option;

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: readonly OptionInput[];
  placeholder?: string;
  /** Show an "all/none" option that maps to an empty value (for filters). */
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A compact dropdown with a branded list. Options can be plain strings (value ===
 * label) or {value,label}. A search box appears automatically when the list is long.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowEmpty = false,
  emptyLabel = "All",
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const opts: Option[] = useMemo(
    () => options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
    [options],
  );
  const showSearch = opts.length > 7;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled]);

  const filtered = opts.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const current = opts.find((o) => o.value === value);
  const shownLabel = current?.label || (allowEmpty ? emptyLabel : "");

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        className={`input flex items-center justify-between gap-2 text-left ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={shownLabel ? "truncate" : "truncate text-muted"}>
          {shownLabel || placeholder}
        </span>
        <span className="text-orange-deep shrink-0">▾</span>
      </button>

      {!disabled && open && (
        <div className="absolute z-40 mt-1 w-full min-w-[220px] rounded-keystone border border-border bg-card shadow-xl">
          {showSearch && (
            <div className="p-2 border-b border-border">
              <input
                autoFocus
                className="input py-1.5 text-sm"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {allowEmpty && <Row label={emptyLabel} active={!value} onClick={() => choose("")} />}
            {filtered.map((o) => (
              <Row key={o.value} label={o.label} active={o.value === value} onClick={() => choose(o.value)} />
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-orange-light ${
          active ? "bg-orange-light/60 font-medium text-orange-deep" : ""
        }`}
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );
}
