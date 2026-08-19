import { useEffect, useRef } from "react";
import { mulberry32 } from "../rng";
import type { PalcoSnapshot } from "../types";

type FeedItem = PalcoSnapshot["feed"][number];

interface ConfettiProps {
  feed: FeedItem[];
}

const BURST_DURATION_MS = 1500;
const PARTICLE_COUNT = 48;
const GRAVITY = 0.16;
// pxpush-only palette — no new colors introduced (terminal green,
// lightblue, ink, red, from theme.css's tokens).
const COLORS = ["#0f0", "#9fe4f3", "#bababa", "#ff001a"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
}

/** Deterministic particle field for one burst, seeded from the triggering
 * `record_broken` event id (mulberry32) — the same event id always
 * produces the same confetti pattern, matching this codebase's "seeded,
 * never Math.random" rule (see rng.ts's doc comment). */
function buildParticles(seed: number, width: number): Particle[] {
  const rng = mulberry32(seed);
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: width / 2 + (rng() - 0.5) * width * 0.6,
      y: 0,
      vx: (rng() - 0.5) * 6,
      vy: rng() * -6 - 2,
      size: rng() * 5 + 3,
      color: COLORS[Math.floor(rng() * COLORS.length)],
      rotation: rng() * 360,
      rotationSpeed: (rng() - 0.5) * 20,
    });
  }
  return particles;
}

function safeGetContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext("2d");
  } catch {
    // jsdom (component tests) has no real 2D context — same "not
    // implemented" posture App.test.tsx already documents for chart.js.
    return null;
  }
}

/**
 * Magic-UI-style confetti burst: a fixed full-viewport <canvas>, hand-rolled
 * rAF particle sim (no dependency), fired ONCE per genuinely NEW
 * `record_broken` feed item — tracked via a ref of previously-seen ids, the
 * same "never replay on the initial snapshot population" convention
 * MuralTab.tsx uses for its own scrap slide-in highlight (`prevIds.size >
 * 0` gate). Fire-and-forget: draws for ~1.5s then stops; nothing to clean
 * up between bursts beyond the rAF handle.
 */
export function Confetti({ feed }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const recordItems = feed.filter((item) => item.type === "record_broken");
    const prevIds = seenIdsRef.current;
    const freshItem = prevIds.size > 0 ? recordItems.find((item) => !prevIds.has(item.id)) : undefined;
    seenIdsRef.current = new Set(recordItems.map((item) => item.id));

    if (!freshItem) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = safeGetContext(canvas);
    if (!ctx) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles = buildParticles(freshItem.id, width);
    const startedAt = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startedAt;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (elapsed >= BURST_DURATION_MS) return;

      const t = elapsed / 1000;
      for (const p of particles) {
        const x = p.x + p.vx * t * 60;
        const y = p.y + p.vy * t * 60 + 0.5 * GRAVITY * (t * 60) ** 2;
        const rotation = p.rotation + p.rotationSpeed * t * 60;
        if (y > height + 40) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [feed]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55]" />;
}
