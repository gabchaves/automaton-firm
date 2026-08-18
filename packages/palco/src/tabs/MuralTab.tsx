import { useEffect, useMemo, useRef, useState } from "react";
import type { PalcoSnapshot } from "../types";
import { relativeTime } from "../format";
import { initials, avatarBackground } from "../avatar";
import { seededReactions } from "../rng";
import { buildMuralPosts } from "./mural-posts";

interface MuralTabProps {
  snapshot: PalcoSnapshot | null;
}

const REACTIONS_DISCLAIMER = "reações são decorativas — ninguém está de fato aplaudindo (ainda)";

export function MuralTab({ snapshot }: MuralTabProps) {
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const feed = snapshot?.feed ?? [];
  // Captured once per render — a relative-time label that refreshes
  // whenever a new snapshot arrives over SSE is good enough here; no
  // ticking clock needed.
  const nowMs = Date.now();

  useEffect(() => {
    const currentIds = new Set(feed.map((item) => item.id));
    const prevIds = prevIdsRef.current;
    const fresh = new Set<number>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) fresh.add(id);
    }
    // Only highlight items that arrived after the first snapshot — the
    // initial population of the mural shouldn't fade-in as "new".
    if (prevIds.size > 0) setNewIds(fresh);
    prevIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastEventId]);

  const posts = useMemo(() => buildMuralPosts(feed), [feed]);

  if (posts.length === 0) {
    return <p>Sem eventos ainda.</p>;
  }

  return (
    <div>
      <p className="mural-disclaimer">{REACTIONS_DISCLAIMER}</p>
      <ul className="mural-feed">
        {posts.map((post) => {
          const highlighted = post.memberIds.some((id) => newIds.has(id));
          const reactions = seededReactions(post.reactionSeed, post.includeSad);

          return (
            <li key={post.key} className={highlighted ? "mural-post fade-highlight" : "mural-post"}>
              <div className="post-avatar" style={{ background: avatarBackground(post.author.name) }}>
                {initials(post.author.name)}
              </div>
              <div className="post-body">
                <div className="post-author">
                  <span className="author-name">{post.author.name}</span>
                  <span className="author-cargo">{post.author.cargo}</span>
                  <span className="post-ts">{relativeTime(post.ts, nowMs)}</span>
                </div>
                <div className="post-headline">{post.headline}</div>
                {post.fallbackHtml !== undefined ? (
                  /*
                    Last-resort fallback for an event type mural-posts.ts
                    doesn't model as structured text. Safe: item.html is
                    produced server-side by src/motor/palco-format.ts's
                    formatEventPt, which escapes every payload value through
                    escapeHtml before interpolation. No client-supplied or
                    unescaped string ever reaches this prop.
                  */
                  <p className="post-text" dangerouslySetInnerHTML={{ __html: post.fallbackHtml }} />
                ) : (
                  <p className="post-text">{post.body}</p>
                )}
                {post.quoted && <blockquote className="post-reason">{post.quoted}</blockquote>}
                <div className="post-reactions">
                  <span className="reaction">👏 {reactions.clap}</span>
                  <span className="reaction">🔥 {reactions.fire}</span>
                  {reactions.sad !== null && <span className="reaction">😢 {reactions.sad}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
