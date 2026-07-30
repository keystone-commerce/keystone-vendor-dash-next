import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";

/**
 * ProgressButton
 *
 * A button that shows progress feedback for async actions.
 *
 * Two modes:
 *  1. **Controlled** (preferred here) — pass `loading` (e.g. a react-query
 *     `mutation.isPending`) and the button mirrors the *real* work. Nothing is
 *     faked, and it never claims success on failure.
 *  2. **Uncontrolled** — omit `loading` and it awaits your `onClick`, showing a
 *     spinner until that promise settles. Success only shows if it resolves.
 *
 * `duration` only drives the optional progress bar's animation; it is never used
 * to decide when the action is "done".
 */

interface ProgressButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loadingLabel?: string;
  successLabel?: string;
  /** Show a progress bar along the bottom edge instead of a spinner. */
  showBar?: boolean;
  /** How long the progress bar takes to fill (visual only). */
  duration?: number;
  /** Controlled busy state — when provided, this wins over internal state. */
  loading?: boolean;
  /** Controlled success state — shows the tick + successLabel. */
  success?: boolean;
}

const ProgressButton: React.FC<ProgressButtonProps> = ({
  label,
  loadingLabel = "Processing...",
  successLabel = "Done!",
  showBar = false,
  duration = 2000,
  loading: loadingProp,
  success: successProp,
  className,
  onClick,
  disabled,
  ...props
}) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalSuccess, setInternalSuccess] = useState(false);
  const [progress, setProgress] = useState(0);

  const isControlled = loadingProp !== undefined;
  const loading = isControlled ? loadingProp : internalLoading;
  const success = successProp ?? (isControlled ? false : internalSuccess);

  // Fill the bar while busy (visual only — completion is driven by the real work).
  React.useEffect(() => {
    if (!showBar || !loading) {
      setProgress(0);
      return;
    }
    const stepSize = 100 / Math.max(duration / 100, 1);
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + stepSize, 95)); // hold at 95% until it finishes
    }, 100);
    return () => clearInterval(interval);
  }, [showBar, loading, duration]);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (loading) return;
    if (isControlled) {
      // Parent owns the busy state; just forward the click.
      onClick?.(e);
      return;
    }
    setInternalLoading(true);
    setInternalSuccess(false);
    try {
      // Await the caller's handler so the spinner tracks the actual work.
      await onClick?.(e);
      setInternalSuccess(true);
      setTimeout(() => setInternalSuccess(false), 1500);
    } catch {
      // Failed — deliberately do not show success; the caller surfaces the error.
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 px-4 py-2 disabled:opacity-60",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {showBar && loading ? (
        <div className="absolute bottom-0 left-0 h-1 bg-primary-foreground/50 w-full overflow-hidden">
          <div
            className="h-full bg-primary-foreground transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      <span className="flex items-center gap-2">
        {loading && !showBar && <Loader2 className="w-4 h-4 animate-spin" />}
        {success && <Check className="w-4 h-4" />}
        {loading ? loadingLabel : success ? successLabel : label}
      </span>
    </button>
  );
};

export default ProgressButton;
