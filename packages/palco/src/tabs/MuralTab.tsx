import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { PalcoSnapshot } from "../types";
import { absoluteTimestamp } from "../format";
import { initials, avatarBackground } from "../avatar";
import { seededReactions } from "../rng";
import { buildMuralPosts } from "./mural-posts";

interface MuralTabProps {
  snapshot: PalcoSnapshot | null;
}

const REACTIONS_DISCLAIMER = "reações são decorativas — ninguém está de fato aplaudindo (ainda)";

// Fun-pass addendum: 3 decorative joke communities, verbatim from the v3
// plan's addendum. Fixed strings, never derived from real data — fun here
// is copy/decoration only, per the addendum's own rule ("never fake DATA").
const JOKE_COMMUNITIES = [
  "Eu amo taxa de funding (12 membros)",
  "Perdi tudo no 3x alavancado (5.021 membros)",
  "RH me demitiu por evidência (1 membro)",
];

const VISITOR_NUMBER_DIGITS = 6;
const SLIDE_DOWN_DURATION_S = 0.35;

/** "N pessoas aplaudiram" / "1 pessoa aplaudiu" — same PT singular/plural
 * handling convention as mural-posts.ts's grouped-trade count. */
function clapPhrase(n: number): string {
  return n === 1 ? "1 pessoa aplaudiu" : `${n} pessoas aplaudiram`;
}

/** Fake visitor counter (fun-pass addendum): `lastEventId`, zero-padded to
 * 6 digits — real underlying number, decorative framing only. */
function visitorNumber(lastEventId: number): string {
  return String(Math.max(0, lastEventId)).padStart(VISITOR_NUMBER_DIGITS, "0");
}

export function MuralTab({ snapshot }: MuralTabProps) {
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const feed = snapshot?.feed ?? [];

  useEffect(() => {
    const currentIds = new Set(feed.map((item) => item.id));
    const prevIds = prevIdsRef.current;
    const fresh = new Set<number>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) fresh.add(id);
    }
    // Only highlight items that arrived after the first snapshot — the
    // initial population of the mural shouldn't slide-in/flash as "new".
    if (prevIds.size > 0) setNewIds(fresh);
    prevIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastEventId]);

  const genStartMc = snapshot?.cards.genStartMc;
  const posts = useMemo(() => buildMuralPosts(feed, genStartMc), [feed, genStartMc]);

  if (posts.length === 0) {
    return <p>Sem eventos ainda.</p>;
  }

  return (
    <section className="orkut-panel">
      <div className="orkut-scanlines" />

      <div className="orkut-header-bar">
        <div className="orkut-tabs">
          <span className="orkut-tab orkut-tab-active">scraps ({posts.length})</span>
        </div>
        <div className="orkut-breadcrumb">
          <span className="orkut-crumb-link">perfil</span> · <span className="orkut-crumb-current">scraps</span> ·{" "}
          <span className="orkut-crumb-link">depoimentos</span>
        </div>
      </div>

      <div className="orkut-body">
        <p className="orkut-visitor-counter">você é o visitante nº {visitorNumber(snapshot?.lastEventId ?? 0)}</p>

        <div className="orkut-communities">
          <h4>comunidades</h4>
          <ul>
            {JOKE_COMMUNITIES.map((community) => (
              <li key={community}>{community}</li>
            ))}
          </ul>
        </div>

        <ul className="orkut-scrap-list">
          {posts.map((post) => {
            const highlighted = post.memberIds.some((id) => newIds.has(id));
            const reactions = seededReactions(post.reactionSeed, post.includeSad);

            return (
              <motion.li
                key={post.key}
                className={`orkut-scrap${highlighted ? " orkut-scrap-new" : ""}`}
                // Slide-down entrance for NEW scraps only (v3 Task 5) —
                // `initial={false}` skips the enter transition entirely for
                // everything else, so a normal re-render never replays it.
                initial={highlighted ? { opacity: 0, y: -16 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: SLIDE_DOWN_DURATION_S, ease: "easeOut" }}
              >
                <div className="orkut-avatar" style={{ background: avatarBackground(post.author.name) }}>
                  {initials(post.author.name)}
                </div>

                <div className="orkut-scrap-main">
                  <div className="orkut-scrap-header">
                    <span className="orkut-author-link">{post.author.name}</span>
                    <span className="orkut-cargo">{post.author.cargo}</span>
                  </div>

                  <div className="orkut-scrap-box">
                    <div className="orkut-headline">{post.headline}</div>
                    {post.fallbackHtml !== undefined ? (
                      /*
                        Last-resort fallback for an event type mural-posts.ts
                        doesn't model as structured text. Safe: item.html is
                        produced server-side by src/motor/palco-format.ts's
                        formatEventPt, which escapes every payload value
                        through escapeHtml before interpolation. No
                        client-supplied or unescaped string ever reaches
                        this prop — XSS posture unchanged from the v2 layout.
                      */
                      <p className="orkut-post-text" dangerouslySetInnerHTML={{ __html: post.fallbackHtml }} />
                    ) : (
                      <p className="orkut-post-text">{post.body}</p>
                    )}
                    {post.quoted && <blockquote className="orkut-quoted">{post.quoted}</blockquote>}
                    <span className="orkut-timestamp">{absoluteTimestamp(post.ts)}</span>
                  </div>

                  <div className="orkut-footer-links">
                    <span className="orkut-reaction-link">👏 {clapPhrase(reactions.clap)}</span>
                    {" · "}
                    <span className="orkut-reaction-link">🔥 {reactions.fire}</span>
                    {reactions.sad !== null && (
                      <>
                        {" · "}
                        <span className="orkut-reaction-link">😢 {reactions.sad}</span>
                      </>
                    )}
                    {" · "}
                    <span className="orkut-reaction-link">responder</span>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ul>

        <p className="orkut-disclaimer-footer">{REACTIONS_DISCLAIMER}</p>
      </div>
    </section>
  );
}
