import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

interface AnimatedValueProps {
  value: number;
  format: (value: number) => string;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 300;

/**
 * Animates a numeric hero value on change instead of snapping straight to
 * the new render — "hero strip numbers animate on change" from the v3
 * plan's Task 1. Uses framer-motion's standalone `animate()` value-tween
 * API (no `motion.*` component needed) to interpolate from the previous
 * number to the new one over `durationMs` (300ms by default), formatting
 * each intermediate frame with the caller-supplied `format` (usually
 * `usd`, or a plain integer/decimal formatter).
 *
 * On mount the displayed value equals `value` immediately (no animation
 * plays for the initial render) — only a genuine prop change triggers a
 * tween, so this stays cheap and deterministic for anything that doesn't
 * change between renders.
 */
export function AnimatedValue({ value, format, durationMs = DEFAULT_DURATION_MS }: AnimatedValueProps) {
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const from = prevValueRef.current;
    prevValueRef.current = value;
    if (from === value) return;

    const controls = animate(from, value, {
      duration: durationMs / 1000,
      ease: "easeOut",
      onUpdate: setDisplay,
    });

    return () => controls.stop();
  }, [value, durationMs]);

  return <span>{format(display)}</span>;
}
