import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { PalcoSnapshot } from "../types";
import { absoluteTimestamp } from "../format";
import { initials, avatarBackground } from "../avatar";
import { seededReactions, seededKarma, seededPick } from "../rng";
import { buildMuralPosts, type FeedItem } from "./mural-posts";

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
// v4 Task B2 Orkut escalation: how many names the decorative "visitas
// recentes" line shows, and a seed offset so its shuffle never draws the
// same mulberry32 sequence as any per-event seed (event ids and
// lastEventId stay far below this in practice — it only needs to differ,
// not be cryptographically distinct).
const RECENT_VISITORS_COUNT = 3;
const RECENT_VISITORS_SEED_OFFSET = 7_919;

// v4.2 Task 2b: "carregar mais" pagination — how many older events each
// click asks GET /api/feed for. Mirrors the server's own DEFAULT_FEED_LIMIT
// (scripts/palco-server.mjs); a mismatch isn't a correctness bug (the
// server always honors ?limit=), just a slightly odd page size, so no
// runtime coupling is needed between the two.
const FEED_PAGE_LIMIT = 20;

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

/** 2-3 names for the "visitas recentes" decorative line (v4 Task B2's
 * Orkut escalation), deterministically picked from the CURRENT
 * generation's real trader roster (`org.employees`) — same "never fake
 * DATA" rule as `JOKE_COMMUNITIES` below: the NAMES are real, only the
 * framing ("visitando o mural") is decorative. Seeded off `lastEventId` so
 * the list is stable across re-renders of the same snapshot and reshuffles
 * only as the feed actually moves. */
function recentVisitorNames(employees: Array<{ name: string }>, lastEventId: number): string[] {
  const uniqueNames = Array.from(new Set(employees.map((e) => e.name)));
  return seededPick(uniqueNames, RECENT_VISITORS_COUNT, lastEventId + RECENT_VISITORS_SEED_OFFSET);
}

export function MuralTab({ snapshot }: MuralTabProps) {
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  // v4.2 Task 2b: older pages fetched via "carregar mais", accumulated
  // across clicks and appended after the live feed (see `combinedFeed`
  // below). `hasMore` hides the button once a page comes back short of
  // FEED_PAGE_LIMIT (the server's tell that there's nothing older left).
  const [olderItems, setOlderItems] = useState<FeedItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
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

  // The live feed (newest N events) followed by every older page loaded so
  // far — one array fed through buildMuralPosts so trade-grouping/karma/
  // voice all run through the SAME logic for old and new posts alike (no
  // second code path to keep in sync). Ids are unique and the live feed's
  // oldest id only ever moves forward over time, so appending older pages
  // after it can never reintroduce a duplicate.
  const combinedFeed = useMemo(() => [...feed, ...olderItems], [feed, olderItems]);
  const genStartMc = snapshot?.cards.genStartMc;
  const posts = useMemo(() => buildMuralPosts(combinedFeed, genStartMc), [combinedFeed, genStartMc]);
  const employees = snapshot?.org.employees ?? [];
  const lastEventId = snapshot?.lastEventId ?? 0;
  const recentVisitors = useMemo(
    () => recentVisitorNames(employees, lastEventId),
    // employees is a fresh array reference on every snapshot poll even when
    // its content is unchanged — keying off its length + lastEventId (both
    // primitives) avoids reshuffling on every render for no reason while
    // still reacting to a real roster or feed change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees.length, lastEventId],
  );

  /** "carregar mais" click handler (v4.2 Task 2b): fetches the next older
   * page from the oldest event id currently rendered, appends it to
   * `olderItems`, and hides the button once a page comes back short of
   * FEED_PAGE_LIMIT — the server's signal there's nothing older left. A
   * fetch/network failure leaves `hasMore` untouched so the button stays
   * clickable for a manual retry, instead of silently going dead. */
  async function handleLoadMore(): Promise<void> {
    if (combinedFeed.length === 0) return;
    const oldestId = combinedFeed[combinedFeed.length - 1].id;

    setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/feed?before=${oldestId}&limit=${FEED_PAGE_LIMIT}`);
      if (!res.ok) return;
      const data = (await res.json()) as { feed: FeedItem[] };
      setOlderItems((prev) => [...prev, ...data.feed]);
      if (data.feed.length < FEED_PAGE_LIMIT) setHasMore(false);
    } catch {
      // Network hiccup — leave hasMore as-is, the button remains clickable.
    } finally {
      setIsLoadingMore(false);
    }
  }

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
        <p className="orkut-visitor-counter">você é o visitante nº {visitorNumber(lastEventId)}</p>

        {recentVisitors.length > 0 && (
          <p className="orkut-recent-visitors">
            visitas recentes: {recentVisitors.join(", ")}{" "}
            <span className="orkut-decorative-tag">(decorativo — ninguém está de fato batendo ponto aqui)</span>
          </p>
        )}

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
            const karma = seededKarma(post.reactionSeed);

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
                    <span className="orkut-karma" title="karma decorativo, ninguém audita isso">
                      ★ {karma} karma
                    </span>
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

        {hasMore && (
          <div className="orkut-load-more">
            <button
              type="button"
              className="orkut-load-more-btn"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "carregando..." : "ver mais scraps"}
            </button>
          </div>
        )}

        <p className="orkut-disclaimer-footer">{REACTIONS_DISCLAIMER}</p>
      </div>
    </section>
  );
}
