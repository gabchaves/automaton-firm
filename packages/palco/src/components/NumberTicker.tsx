import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { cn } from "../lib/utils";

interface NumberTickerProps {
  value: number;
  format: (value: number) => string;
  /** Explicit override for the caller. When omitted, defaults from
   * `prefers-reduced-motion` (real users) or the Vitest/jsdom test
   * environment (component tests). */
  reduced?: boolean;
  className?: string;
}

const SPRING_STIFFNESS = 90;
const SPRING_DAMPING = 20;

/** Real users: respect the OS-level reduced-motion setting. Test env: no
 * rAF/spring worth waiting on in jsdom — render the final formatted value
 * synchronously so component tests stay stable without fake timers or
 * `waitFor`. Vitest sets `import.meta.env.MODE` to "test" by default (same
 * mechanism Vite uses for `--mode`), which is how this distinguishes a
 * `vitest run` process from an actual `vite build`/`vite dev` one. */
function defaultReducedMotion(): boolean {
  if (import.meta.env.MODE === "test") return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Magic-UI-style "Number Ticker": spring-animates a numeric hero value
 * between renders instead of snapping straight to the new formatted string
 * (v3.2 plan, Commit 1 — replaces AnimatedValue's linear tween for the hero
 * strip and the Sobre facts strip). `format` is called with each
 * intermediate raw numeric frame, so "$96.36"-style output animates simply
 * by re-formatting the animating number every tick — the "$" and decimal
 * point are just part of whatever `format` returns each frame, not
 * separately animated glyphs.
 *
 * On mount the displayed value equals `value` immediately (no animation
 * plays for the initial render — same convention as AnimatedValue). When
 * `reduced` (explicit or matchMedia/test-env-derived) is true, value
 * changes also snap immediately instead of springing.
 */
export function NumberTicker({ value, format, reduced, className }: NumberTickerProps) {
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(value);
  const [reducedMotion] = useState(() => reduced ?? defaultReducedMotion());

  useEffect(() => {
    const from = prevValueRef.current;
    prevValueRef.current = value;
    if (from === value) return;

    if (reducedMotion) {
      setDisplay(value);
      return;
    }

    const controls = animate(from, value, {
      type: "spring",
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
      restDelta: 0.01,
      onUpdate: setDisplay,
    });

    return () => controls.stop();
  }, [value, reducedMotion]);

  return <span className={cn("tabular-nums", className)}>{format(display)}</span>;
}
