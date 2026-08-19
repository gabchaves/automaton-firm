import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface ShineBorderProps {
  children: ReactNode;
  /** Caller-supplied gate (e.g. App.tsx's `recordEvolvedMc > SEED_EQUITY_MC`
   * — a genuine new record above the $100 seed). Keeps this component a
   * dumb, reusable wrapper with no opinion about what "a real record" means. */
  active: boolean;
  className?: string;
}

const SHINE_OVERLAY_INSET_PX = -2;

/**
 * Magic-UI-style animated border shine — a light band sweeps once across a
 * gradient overlay, then stops. Pure CSS (`animate-shine`, see tw.css's
 * `@theme`/`@keyframes shine`, which deliberately omits `infinite`) — same
 * "conditional class, no JS scheduler" convention theme.css already uses
 * for `.orkut-scrap-new`'s one-shot new-post flash. Per the v3.2 plan, the
 * ticker-tape Marquee is the only continuous/looping animation this app
 * budgets for; this is a one-shot embellishment for a genuinely new record
 * on the "Recorde (pico)" hero card, not a second infinite loop.
 */
export function ShineBorder({ children, active, className }: ShineBorderProps) {
  return (
    <div className={cn("relative", className)}>
      {active && (
        <div
          aria-hidden="true"
          data-testid="shine-border-overlay"
          className={cn(
            "pointer-events-none absolute animate-shine rounded-[inherit]",
            "[background-image:linear-gradient(110deg,transparent_35%,var(--color-terminal)_50%,transparent_65%)]",
            "[background-size:200%_100%]",
          )}
          style={{ inset: SHINE_OVERLAY_INSET_PX }}
        />
      )}
      {children}
    </div>
  );
}
