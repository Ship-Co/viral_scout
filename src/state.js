import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const STATE_PATH = "state/fire-scout.json";
const LOCAL_STATE_PATH = resolve("data/fire-scout-state.json");
const RETENTION_HOURS = 80;
const MAX_SNAPSHOTS_PER_POST = 80;

function emptyState() {
  return { version: 1, updatedAt: null, lastDigestDate: null, posts: {} };
}

function useBlob() {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function loadState() {
  if (!useBlob()) {
    try {
      return JSON.parse(await readFile(LOCAL_STATE_PATH, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return emptyState();
      throw error;
    }
  }

  const { get } = await import("@vercel/blob");
  const result = await get(STATE_PATH, { access: "private" });
  if (!result) return emptyState();
  return JSON.parse(await new Response(result.stream).text());
}

export async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  if (!useBlob()) {
    await mkdir(dirname(LOCAL_STATE_PATH), { recursive: true });
    await writeFile(LOCAL_STATE_PATH, JSON.stringify(state), "utf8");
    return;
  }

  const { put } = await import("@vercel/blob");
  await put(STATE_PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

function metricsChanged(previous, next) {
  if (!previous) return true;
  return ["likes", "reposts", "replies", "quotes", "bookmarks", "views"]
    .some((key) => Number(previous[key] || 0) !== Number(next[key] || 0));
}

export function mergeCollection(state, tweets, decisions = new Map(), now = new Date()) {
  const observedAt = now.toISOString();
  state.posts ||= {};

  for (const tweet of tweets) {
    if (!tweet?.id) continue;
    const existing = state.posts[tweet.id];
    const sources = new Set([...(existing?.sources || []), tweet.source].filter(Boolean));
    const snapshots = [...(existing?.snapshots || [])];
    const latestMetrics = snapshots.at(-1)?.metrics;
    if (metricsChanged(latestMetrics, tweet.metrics)) {
      snapshots.push({ at: observedAt, metrics: { ...tweet.metrics } });
    }
    state.posts[tweet.id] = {
      post: { ...tweet, source: tweet.source || existing?.post?.source || "state" },
      sources: [...sources],
      firstSeenAt: existing?.firstSeenAt || observedAt,
      lastSeenAt: observedAt,
      snapshots: snapshots.slice(-MAX_SNAPSHOTS_PER_POST),
      decision: decisions.get(tweet.id) || existing?.decision || null,
    };
  }

  const cutoff = now.getTime() - RETENTION_HOURS * 3_600_000;
  for (const [id, record] of Object.entries(state.posts)) {
    const created = new Date(record.post?.createdAt || 0).getTime();
    const lastSeen = new Date(record.lastSeenAt || 0).getTime();
    if (Math.max(created, lastSeen) < cutoff) delete state.posts[id];
  }
  return state;
}

function snapshotVelocity(snapshots) {
  if (!snapshots || snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots.at(-1);
  const hours = (new Date(last.at) - new Date(first.at)) / 3_600_000;
  if (hours < 0.12) return null;
  const delta = Object.fromEntries(
    ["likes", "reposts", "replies", "quotes", "bookmarks", "views"].map((key) => [
      key,
      Math.max(0, Number(last.metrics[key] || 0) - Number(first.metrics[key] || 0)),
    ])
  );
  const velocity = Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, value / hours]));

  let acceleration = 1;
  if (snapshots.length >= 3) {
    const middle = snapshots.at(-2);
    const recentHours = (new Date(last.at) - new Date(middle.at)) / 3_600_000;
    const priorHours = (new Date(middle.at) - new Date(first.at)) / 3_600_000;
    if (recentHours >= 0.12 && priorHours >= 0.12) {
      const recent = Math.max(0, last.metrics.likes - middle.metrics.likes) / recentHours;
      const prior = Math.max(0, middle.metrics.likes - first.metrics.likes) / priorHours;
      acceleration = prior > 1 ? recent / prior : recent > 5 ? 2 : 1;
    }
  }
  return { observedHours: hours, delta, velocity, acceleration };
}

export function postsFromState(state, options = {}) {
  const now = options.now || new Date();
  const hours = options.hours ?? RETENTION_HOURS;
  const cutoff = now.getTime() - hours * 3_600_000;
  return Object.values(state.posts || {})
    .filter((record) => new Date(record.post?.createdAt || 0).getTime() >= cutoff)
    .map((record) => ({
      ...record.post,
      source: record.sources?.join(",") || record.post.source,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      observed: snapshotVelocity(record.snapshots),
    }));
}

export function decisionsFromState(state) {
  return new Map(Object.entries(state.posts || {})
    .filter(([, record]) => record.decision)
    .map(([id, record]) => [id, record.decision]));
}

export function unseenPosts(posts, state) {
  return posts.filter((post) => !state.posts?.[post.id]?.decision);
}
