"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExpandableSearchBarProps = {
  expandDirection?: "left" | "right";
  placeholder?: string;
  onSearch?: (query: string) => void;
  className?: string;
  defaultOpen?: boolean;
  width?: number;
};

const COLLAPSED_SIZE = 40;

export default function ExpandableSearchBar({
  expandDirection = "right",
  placeholder = "Search...",
  onSearch,
  className = "",
  defaultOpen = false,
  width = 280,
}: ExpandableSearchBarProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const inputPadding = expandDirection === "right" ? "pl-11" : "pl-10";
  const placeholderLeft = expandDirection === "right" ? "left-11" : "left-10";

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node) && open && value === "") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open, value]);

  useEffect(() => {
    if (open) {
      const timeout = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(timeout);
    }
    setValue("");
  }, [open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSearch?.(value);
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block", className)}
      style={{ width: COLLAPSED_SIZE, height: COLLAPSED_SIZE }}
    >
      <button
        type="button"
        aria-label={open ? "Close search" : "Open search"}
        onClick={() => {
          if (open) onSearch?.("");
          setOpen((current) => !current);
        }}
        className={cn(
          "absolute inset-0 z-20 grid place-items-center rounded-full border",
          "bg-secondary text-foreground/80 transition-colors hover:text-foreground",
          "dark:bg-secondary dark:text-foreground/80 dark:hover:text-foreground",
        )}
      >
        {open ? <X className="size-4" /> : <Search className="size-4" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.form
            key="form"
            onSubmit={submit}
            className={cn(
              "absolute top-0 flex h-10 items-center overflow-hidden rounded-full border bg-background text-foreground shadow-sm",
              expandDirection === "left" ? "right-0" : "left-0",
            )}
            initial={{ width: COLLAPSED_SIZE, opacity: 0.98 }}
            animate={{ width, opacity: 1 }}
            exit={{
              width: COLLAPSED_SIZE,
              opacity: 0,
              transition: { type: "spring", stiffness: 260, damping: 26 },
            }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          >
            <span className="absolute left-3 z-10 text-muted-foreground">
              <Search className="size-4" />
            </span>

            <div className="relative flex min-w-0 flex-1 items-center">
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={placeholder}
                className={cn(
                  "w-full overflow-x-auto whitespace-nowrap bg-transparent text-sm outline-none placeholder-transparent",
                  inputPadding,
                )}
              />
              <AnimatePresence>
                {!value && (
                  <motion.span
                    key="placeholder"
                    className={cn(
                      "pointer-events-none absolute top-1/2 w-full -translate-y-1/2 truncate text-left text-sm text-muted-foreground/80 select-none",
                      placeholderLeft,
                    )}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0.9 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: 0.2 }}
                  >
                    {placeholder}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <button
              type="submit"
              className="grid h-10 w-10 place-items-center text-muted-foreground hover:text-foreground"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
