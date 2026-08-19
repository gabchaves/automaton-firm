import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface MarqueeProps {
  children: ReactNode;
  className?: string;
  pauseOnHover?: boolean;
}

/**
 * Magic-UI-style infinite horizontal marquee: two identical copies of
 * `children` sit side by side in one flex row; a CSS keyframe
 * (`animate-marquee`, see tw.css's `@theme`/`@keyframes marquee`)
 * translates that row by exactly -50%, so the second copy lands exactly
 * where the first one started — a seamless loop with zero JS, transform-only
 * (compositor-friendly, per the v3.2 plan's performance discipline).
 * `group-hover:[animation-play-state:paused]` pauses on hover without a
 * second keyframe or a JS listener.
 *
 * This is the one continuous, looping animation in the app (theme.css's
 * header comment rules out others beyond the live-dot pulse) — a stock
 * ticker earns the motion a fade-in or a pulse dot doesn't.
 */
export function Marquee({ children, className, pauseOnHover = true }: MarqueeProps) {
  return (
    <div className={cn("group flex w-full overflow-hidden", className)}>
      <div
        className={cn(
          "flex w-max animate-marquee items-center",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
      >
        <div className="flex items-center gap-10 pr-10">{children}</div>
        <div aria-hidden="true" className="flex items-center gap-10 pr-10">
          {children}
        </div>
      </div>
    </div>
  );
}
