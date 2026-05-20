#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VIEWER_URL = "http://localhost:3113";
const DEFAULT_REST_URL = "http://localhost:3111";
const DEFAULT_SECRET = "local-dev";
const DEFAULT_LIMIT = 1000;
const DEFAULT_PER_SESSION = 12;
const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_MIN_SCORE = 70;
const DEFAULT_SLEEP_MS = 1500;
const DEFAULT_FALLBACK_READ_DELAY_MS = 3500;
const DEFAULT_PROGRESS = "/tmp/agentmemory-graph-backfill-progress.json";
const DEFAULT_MODE = "session";

const LOW_VALUE_TITLES = new Set([
  "post_tool_use",
  "stop",
  "notification",
  "pre_tool_use",
  "session_start",
]);

const HIGH_VALUE_TYPES = new Map([
  ["file_edit", 80],
  ["error", 70],
  ["discovery", 65],
  ["subagent", 55],
  ["file_read", 35],
  ["web_fetch", 30],
  ["command_run", 20],
  ["conversation", 15],
]);

const HIGH_VALUE_TITLES = new Map([
  ["Edit", 65],
  ["Write", 60],
  ["post_tool_failure", 55],
  ["Read", 35],
  ["WebFetch", 30],
  ["WebSearch", 20],
  ["Bash", 15],
]);

const CODE_PATH_RE = /(?:^|[\s"'(:])(?:\/Users\/[^\s"',)]+|(?:packages|apps|src|scripts|docs|test|tests|lib|server|client|web|shared)\/[A-Za-z0-9._/@+-]+(?:\/[A-Za-z0-9._/@+-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|css|scss|html|yaml|yml|toml|py|java|go|rs|sh))/g;
const SYMBOL_RE = /\b[A-Z][A-Za-z0-9]*(?:Service|Provider|Controller|Repository|Store|Page|View|Client|Router|Schema|Config|Manager|Handler|Component|Context|Hook)\b/g;
const PACKAGE_RE = /\b(?:React|Vite|TypeScript|Express|SQLite|better-sqlite3|Vitest|MCP|agentmemory|Anthropic|OpenAI|MiniMax|Gemini|Docker|Node|npm|tsx|Claude|Codex)\b/g;
const LIBRARY_NAMES = [
  "React",
  "Vite",
  "TypeScript",
  "Express",
  "SQLite",
  "better-sqlite3",
  "Vitest",
  "MCP",
  "agentmemory",
  "Anthropic",
  "OpenAI",
  "MiniMax",
  "Gemini",
  "Docker",
  "Node",
  "npm",
  "tsx",
  "Claude",
  "Codex",
  "Spring Boot",
  "Flutter",
  "Dart",
  "Java",
  "Hono",
  "Zod",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function textOf(value) {
  return typeof value === "string" ? value : "";
}

function uniq(values) {
  return [...new Set(values)];
}

function stableId(prefix, parts) {
  const input = parts.join("|");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function stableObservationKey(observation) {
  const files = asArray(observation.files).filter((file) => typeof file === "string" && file.length > 0);
  if (files.length > 0) return `files:${files.slice().sort().join("|")}`;

  const title = textOf(observation.title);
  const type = textOf(observation.type);
  const narrative = textOf(observation.narrative).replace(/\s+/g, " ").trim();
  if (narrative.length > 0) return `text:${type}:${title}:${narrative.slice(0, 240)}`;
  return `id:${observation.id}`;
}

export function scoreObservation(observation) {
  const title = textOf(observation.title);
  const type = textOf(observation.type);
  const narrative = textOf(observation.narrative);
  const files = asArray(observation.files).filter((file) => typeof file === "string" && file.length > 0);
  const concepts = asArray(observation.concepts).filter((concept) => typeof concept === "string" && concept.length > 0);

  let score = 0;
  const reasons = [];

  if (files.length > 0) {
    score += 55 + Math.min(files.length, 6) * 8;
    reasons.push("files");
  }

  if (concepts.length > 0) {
    score += 45 + Math.min(concepts.length, 6) * 5;
    reasons.push("concepts");
  }

  if (HIGH_VALUE_TYPES.has(type)) {
    score += HIGH_VALUE_TYPES.get(type);
    reasons.push(`type:${type}`);
  }

  if (HIGH_VALUE_TITLES.has(title)) {
    score += HIGH_VALUE_TITLES.get(title);
    reasons.push(`title:${title}`);
  }

  if (LOW_VALUE_TITLES.has(title)) {
    score -= 60;
    reasons.push(`low-title:${title}`);
  }

  const pathHits = countMatches(narrative, CODE_PATH_RE);
  if (pathHits > 0) {
    score += Math.min(pathHits, 8) * 12;
    reasons.push("code-paths");
  }

  const symbolHits = countMatches(narrative, SYMBOL_RE);
  if (symbolHits > 0) {
    score += Math.min(symbolHits, 6) * 6;
    reasons.push("symbols");
  }

  const packageHits = countMatches(narrative, PACKAGE_RE);
  if (packageHits > 0) {
    score += Math.min(packageHits, 8) * 5;
    reasons.push("libraries");
  }

  if (/\b(?:bug|fix|failed|failure|error|timeout|401|404|regression|root cause|provider|graph|import|schema|migration)\b/i.test(narrative)) {
    score += 25;
    reasons.push("diagnostic");
  }

  if (narrative.length < 20) {
    score -= 35;
    reasons.push("short");
  } else if (narrative.length > 120) {
    score += 10;
    reasons.push("substantive");
  }

  if (type === "other" && files.length === 0 && concepts.length === 0 && pathHits === 0) {
    score -= 35;
    reasons.push("generic-other");
  }

  return {
    score,
    reasons: uniq(reasons),
  };
}

function coveredObservationIds(exportData) {
  const ids = new Set();
  for (const node of asArray(exportData.graphNodes)) {
    for (const id of asArray(node.sourceObservationIds)) if (typeof id === "string") ids.add(id);
  }
  for (const edge of asArray(exportData.graphEdges)) {
    for (const id of asArray(edge.sourceObservationIds)) if (typeof id === "string") ids.add(id);
  }
  return ids;
}

function normalizeFilePath(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const normalized = value.replace(/\\/g, "/");
  const markers = [
    "/workSpace/",
    "/workspace/",
    "/Code/",
    "/code/",
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      const suffix = normalized.slice(index + marker.length);
      const parts = suffix.split("/").filter(Boolean);
      if (parts.length > 1) return parts.slice(1).join("/");
    }
  }
  return normalized.replace(/^\/+/, "");
}

function displayFilePath(value) {
  const normalized = normalizeFilePath(value);
  return normalized || value;
}

function coveredFilePaths(exportData) {
  const files = new Set();
  for (const node of asArray(exportData.graphNodes)) {
    if (node?.type === "file" && typeof node.name === "string") {
      files.add(normalizeFilePath(node.name));
    }
  }
  return files;
}

function sessionById(exportData) {
  const map = new Map();
  for (const session of asArray(exportData.sessions)) {
    if (session && typeof session.id === "string") map.set(session.id, session);
  }
  return map;
}

export function selectCandidates(exportData, options = {}) {
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  const perSession = Number.isInteger(options.perSession) ? options.perSession : DEFAULT_PER_SESSION;
  const minScore = Number.isInteger(options.minScore) ? options.minScore : DEFAULT_MIN_SCORE;
  const covered = coveredObservationIds(exportData);
  const coveredFiles = coveredFilePaths(exportData);
  const sessions = sessionById(exportData);

  const stats = {
    sessionsConsidered: 0,
    observationsConsidered: 0,
    coveredSkipped: 0,
    fileCoveredSkipped: 0,
    duplicateSkipped: 0,
    lowScoreSkipped: 0,
    selectedBeforeLimit: 0,
  };

  const selected = [];
  const observations = exportData?.observations && typeof exportData.observations === "object" ? exportData.observations : {};

  for (const [sessionId, sessionObservations] of Object.entries(observations)) {
    const scored = [];
    const bestByKey = new Map();
    stats.sessionsConsidered += 1;

    for (const observation of asArray(sessionObservations)) {
      stats.observationsConsidered += 1;
      if (!observation || typeof observation.id !== "string") continue;
      if (covered.has(observation.id)) {
        stats.coveredSkipped += 1;
        continue;
      }
      const files = asArray(observation.files).map(normalizeFilePath).filter(Boolean);
      if (files.length > 0 && files.every((file) => coveredFiles.has(file))) {
        stats.fileCoveredSkipped += 1;
        continue;
      }

      const score = scoreObservation(observation);
      if (score.score < minScore) {
        stats.lowScoreSkipped += 1;
        continue;
      }

      scored.push({
        sessionId,
        session: sessions.get(sessionId) || null,
        observation,
        score: score.score,
        reasons: score.reasons,
      });
    }

    for (const candidate of scored) {
      const key = stableObservationKey(candidate.observation);
      const existing = bestByKey.get(key);
      if (!existing || candidate.score > existing.score || (candidate.score === existing.score && String(candidate.observation.id).localeCompare(String(existing.observation.id)) < 0)) {
        if (existing) stats.duplicateSkipped += 1;
        bestByKey.set(key, candidate);
      } else {
        stats.duplicateSkipped += 1;
      }
    }

    const deduped = [...bestByKey.values()];
    deduped.sort((a, b) => b.score - a.score || String(a.observation.id).localeCompare(String(b.observation.id)));
    selected.push(...deduped.slice(0, Math.max(1, perSession)));
  }

  selected.sort((a, b) => b.score - a.score || String(a.sessionId).localeCompare(String(b.sessionId)));
  stats.selectedBeforeLimit = selected.length;

  return {
    candidates: selected.slice(0, Math.max(1, limit)),
    stats,
  };
}

function topCounts(values, limit) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function sessionLabel(session, sessionId) {
  return session?.project || session?.cwd || session?.firstPrompt || sessionId;
}

export function buildSessionCandidates(exportData, options = {}) {
  const observationSelection = selectCandidates(exportData, {
    ...options,
    limit: Number.isInteger(options.observationLimit) ? options.observationLimit : Math.max((options.limit || DEFAULT_LIMIT) * Math.max(options.perSession || DEFAULT_PER_SESSION, 1), DEFAULT_LIMIT),
  });
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;

  const bySession = new Map();
  for (const candidate of observationSelection.candidates) {
    const bucket = bySession.get(candidate.sessionId) || {
      sessionId: candidate.sessionId,
      session: candidate.session,
      candidates: [],
      score: 0,
    };
    bucket.candidates.push(candidate);
    bucket.score += candidate.score;
    bySession.set(candidate.sessionId, bucket);
  }

  const sessionCandidates = [];
  for (const bucket of bySession.values()) {
    const sorted = bucket.candidates
      .slice()
      .sort((a, b) => b.score - a.score || String(a.observation.id).localeCompare(String(b.observation.id)));
    const sourceObservationIds = sorted.map((candidate) => candidate.observation.id);
    const files = uniq(sorted.flatMap((candidate) => asArray(candidate.observation.files).map(displayFilePath).filter(Boolean))).slice(0, 14);
    const concepts = uniq(sorted.flatMap((candidate) => asArray(candidate.observation.concepts).filter((concept) => typeof concept === "string" && concept.length > 0))).slice(0, 18);
    const types = topCounts(sorted.map((candidate) => textOf(candidate.observation.type)), 8);
    const titles = topCounts(sorted.map((candidate) => textOf(candidate.observation.title)), 8);
    const notable = sorted.slice(0, 8).map((candidate) => {
      const compact = compactObservationForGraph(candidate);
      return `- [${compact.type || "unknown"} / ${compact.title || "untitled"}] ${truncate(compact.narrative, 360)}`;
    });

    const session = bucket.session;
    const narrative = [
      `Project: ${sessionLabel(session, bucket.sessionId)}`,
      session?.cwd ? `CWD: ${session.cwd}` : "",
      session?.firstPrompt ? `First prompt: ${truncate(session.firstPrompt, 240)}` : "",
      `Session ID: ${bucket.sessionId}`,
      files.length > 0 ? `Key files: ${files.join(", ")}` : "",
      concepts.length > 0 ? `Concepts: ${concepts.join(", ")}` : "",
      `Observation types: ${types.map((item) => `${item.value}=${item.count}`).join(", ")}`,
      `Observation titles: ${titles.map((item) => `${item.value}=${item.count}`).join(", ")}`,
      "Important observations:",
      ...notable,
    ].filter(Boolean).join("\n");

    sessionCandidates.push({
      id: `session_graph_${bucket.sessionId}`,
      type: "session_summary",
      title: `Session graph summary: ${sessionLabel(session, bucket.sessionId)}`,
      narrative,
      concepts,
      files,
      sourceObservationIds,
      sessionId: bucket.sessionId,
      session,
      score: bucket.score + concepts.length * 20 + files.length * 8,
      reasons: ["session-aggregate"],
    });
  }

  sessionCandidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    candidates: sessionCandidates.slice(0, Math.max(1, limit)),
    stats: {
      ...observationSelection.stats,
      sessionsSelectedBeforeLimit: sessionCandidates.length,
    },
  };
}

function parseArgs(argv) {
  const options = {
    viewerUrl: process.env.AGENTMEMORY_URL || DEFAULT_VIEWER_URL,
    restUrl: process.env.AGENTMEMORY_REST_URL || DEFAULT_REST_URL,
    secret: process.env.AGENTMEMORY_SECRET || DEFAULT_SECRET,
    limit: DEFAULT_LIMIT,
    perSession: DEFAULT_PER_SESSION,
    batchSize: DEFAULT_BATCH_SIZE,
    minScore: DEFAULT_MIN_SCORE,
    sleepMs: DEFAULT_SLEEP_MS,
    fallbackReadDelayMs: DEFAULT_FALLBACK_READ_DELAY_MS,
    progressPath: DEFAULT_PROGRESS,
    mode: DEFAULT_MODE,
    run: false,
    resetProgress: false,
    output: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--run") options.run = true;
    else if (arg === "--reset-progress") options.resetProgress = true;
    else if (arg === "--viewer-url") options.viewerUrl = next();
    else if (arg === "--rest-url") options.restUrl = next();
    else if (arg === "--secret") options.secret = next();
    else if (arg === "--limit") options.limit = parsePositiveInt(next(), arg);
    else if (arg === "--per-session") options.perSession = parsePositiveInt(next(), arg);
    else if (arg === "--batch-size") options.batchSize = parsePositiveInt(next(), arg);
    else if (arg === "--min-score") options.minScore = parsePositiveInt(next(), arg);
    else if (arg === "--sleep-ms") options.sleepMs = parseNonNegativeInt(next(), arg);
    else if (arg === "--fallback-read-delay-ms") options.fallbackReadDelayMs = parseNonNegativeInt(next(), arg);
    else if (arg === "--mode") {
      const mode = next();
      if (!new Set(["session", "observation", "deterministic"]).has(mode)) throw new Error("--mode must be session, observation, or deterministic");
      options.mode = mode;
    }
    else if (arg === "--progress") options.progressPath = next();
    else if (arg === "--output") options.output = next();
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function usage() {
  return `Usage:
  node scripts/backfill-agentmemory-graph.mjs [options]

Defaults to dry-run. Add --run to write graph nodes through /agentmemory/graph/extract.

Options:
  --run                  Execute extraction. Omit for dry-run.
  --mode MODE            deterministic, session, or observation. Default: ${DEFAULT_MODE}
  --limit N              Max observations to select. Default: ${DEFAULT_LIMIT}
  --per-session N        Max observations per session. Default: ${DEFAULT_PER_SESSION}
  --batch-size N         Observations per graph/extract call. Default: ${DEFAULT_BATCH_SIZE}
  --min-score N          Minimum value score. Default: ${DEFAULT_MIN_SCORE}
  --viewer-url URL       Export/stats URL source. Default: ${DEFAULT_VIEWER_URL}
  --rest-url URL         Direct REST URL for graph/extract. Default: ${DEFAULT_REST_URL}
  --secret VALUE         Bearer token. Default: ${DEFAULT_SECRET}
  --progress PATH        Progress file. Default: ${DEFAULT_PROGRESS}
  --reset-progress       Ignore existing progress file.
  --output PATH          Write selected candidates JSON.
  --sleep-ms N           Delay between write batches. Default: ${DEFAULT_SLEEP_MS}
  --fallback-read-delay-ms N
                         Delay between fallback observation reads. Default: ${DEFAULT_FALLBACK_READ_DELAY_MS}
`;
}

async function fetchJson(url, options = {}) {
  const { fetcher = fetch, ...requestOptions } = options;
  const response = await fetcher(url, requestOptions);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function loadExport(viewerUrl) {
  return fetchJson(`${viewerUrl.replace(/\/$/, "")}/agentmemory/export`);
}

function authHeaders(secret, extra = {}) {
  return {
    "Authorization": `Bearer ${secret}`,
    ...extra,
  };
}

async function fetchFromFirstAvailable(bases, path, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : 3000;
  const sleeper = options.sleeper || sleep;
  const { attempts: _attempts, delayMs: _delayMs, sleeper: _sleeper, ...fetchOptions } = options;

  let errors = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    errors = [];
    for (const base of bases) {
      try {
        return await fetchJson(`${base}${path}`, fetchOptions);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (attempt < attempts) await sleeper(delayMs * attempt);
  }
  throw new Error(errors.join("; "));
}

async function loadExportFallback(viewerUrl, restUrl, secret, fetcher = fetch, warning = "", options = {}) {
  const bases = uniq([restUrl, viewerUrl].map((url) => url.replace(/\/$/, "")));
  const fallbackReadDelayMs = Number.isInteger(options.fallbackReadDelayMs) ? options.fallbackReadDelayMs : DEFAULT_FALLBACK_READ_DELAY_MS;
  const sleeper = options.sleeper || sleep;
  const sessionsResponse = await fetchFromFirstAvailable(bases, "/agentmemory/sessions", {
    fetcher,
    headers: authHeaders(secret),
    sleeper,
  });
  const sessions = asArray(sessionsResponse.sessions);
  const observations = {};

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session?.id) continue;
    if (index > 0 && fallbackReadDelayMs > 0) await sleeper(fallbackReadDelayMs);
    const obsResponse = await fetchFromFirstAvailable(bases, `/agentmemory/observations?sessionId=${encodeURIComponent(session.id)}`, {
      fetcher,
      headers: authHeaders(secret),
      sleeper,
    });
    observations[session.id] = asArray(obsResponse.observations);
  }

  const graphResponse = await fetchFromFirstAvailable(bases, "/agentmemory/graph/query", {
    fetcher,
    method: "POST",
    headers: authHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ maxDepth: 0 }),
    sleeper,
  });

  return {
    version: "0.9.11",
    exportedAt: new Date().toISOString(),
    sessions,
    observations,
    memories: [],
    summaries: [],
    graphNodes: asArray(graphResponse.nodes),
    graphEdges: asArray(graphResponse.edges),
    exportWarning: `Fallback export used after /agentmemory/export failed${warning ? `: ${warning}` : ""}`,
  };
}

export async function loadExportData({ viewerUrl, restUrl, secret, fetcher = fetch, fallbackReadDelayMs = DEFAULT_FALLBACK_READ_DELAY_MS, sleeper = sleep }) {
  try {
    return await fetchJson(`${viewerUrl.replace(/\/$/, "")}/agentmemory/export`, { fetcher });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return loadExportFallback(viewerUrl, restUrl, secret, fetcher, message, { fallbackReadDelayMs, sleeper });
  }
}

async function loadGraphStats(viewerUrl) {
  return fetchJson(`${viewerUrl.replace(/\/$/, "")}/agentmemory/graph/stats`);
}

async function postGraphExtract(restUrl, secret, observations) {
  return fetchJson(`${restUrl.replace(/\/$/, "")}/agentmemory/graph/extract`, {
    method: "POST",
    headers: authHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({ observations }),
  });
}

async function postImport(restUrl, secret, exportData) {
  return fetchJson(`${restUrl.replace(/\/$/, "")}/agentmemory/import`, {
    method: "POST",
    headers: authHeaders(secret, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      strategy: "merge",
      exportData,
    }),
  });
}

async function loadProgress(path, resetProgress) {
  if (resetProgress) return { processed: [] };
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return {
      processed: asArray(data.processed).filter((id) => typeof id === "string"),
    };
  } catch {
    return { processed: [] };
  }
}

async function saveProgress(path, processed) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    updatedAt: new Date().toISOString(),
    processed: [...processed].sort(),
  }, null, 2));
}

function candidateReport(candidate) {
  const observation = candidate.observation || candidate;
  return {
    id: observation.id,
    sessionId: candidate.sessionId,
    project: candidate.session?.project || candidate.session?.cwd || "",
    score: candidate.score,
    reasons: candidate.reasons,
    type: observation.type,
    title: observation.title,
    files: asArray(observation.files).slice(0, 5),
    concepts: asArray(observation.concepts).slice(0, 8),
    narrativePreview: textOf(observation.narrative).replace(/\s+/g, " ").slice(0, 220),
  };
}

function summarizeCandidates(candidates) {
  const byReason = new Map();
  const byType = new Map();
  const byTitle = new Map();
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) byReason.set(reason, (byReason.get(reason) || 0) + 1);
    const observation = candidate.observation || candidate;
    const type = textOf(observation.type) || "(none)";
    const title = textOf(observation.title) || "(none)";
    byType.set(type, (byType.get(type) || 0) + 1);
    byTitle.set(title, (byTitle.get(title) || 0) + 1);
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([key, count]) => ({ key, count }));
  return {
    byType: top(byType, 12),
    byTitle: top(byTitle, 12),
    byReason: top(byReason, 16),
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function tryParseJson(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function unescapeJsonStringFragment(value) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function extractJsonStringField(text, field) {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`);
  const match = pattern.exec(text);
  return match ? unescapeJsonStringFragment(match[1]) : "";
}

function extractLooseJsonFields(text) {
  if (!text || typeof text !== "string") return null;
  if (!text.includes("\"file_path\"") && !text.includes("\"command\"")) return null;
  return {
    file_path: extractJsonStringField(text, "file_path"),
    old_string: extractJsonStringField(text, "old_string"),
    new_string: extractJsonStringField(text, "new_string"),
    command: extractJsonStringField(text, "command"),
    description: extractJsonStringField(text, "description"),
    error: extractJsonStringField(text, "error"),
    stderr: extractJsonStringField(text, "stderr"),
    stdout: extractJsonStringField(text, "stdout"),
  };
}

function truncate(value, maxLength) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function diffSummary(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const lines = [];
  const filePath = typeof parsed.file_path === "string" ? parsed.file_path : "";
  if (filePath) lines.push(`Edited file: ${filePath}`);

  if (typeof parsed.old_string === "string" || typeof parsed.new_string === "string") {
    const oldText = truncate(parsed.old_string, 320);
    const newText = truncate(parsed.new_string, 520);
    if (oldText) lines.push(`Previous content excerpt: ${oldText}`);
    if (newText) lines.push(`Added or changed content: ${newText}`);
  }

  const command = truncate(parsed.command, 500);
  const description = truncate(parsed.description, 240);
  const error = truncate(parsed.error, 400);
  if (command) lines.push(`Command: ${command}`);
  if (description) lines.push(`Description: ${description}`);
  if (error) lines.push(`Error: ${error}`);
  if (typeof parsed.stderr === "string" && parsed.stderr.trim()) lines.push(`stderr: ${truncate(parsed.stderr, 400)}`);
  if (typeof parsed.stdout === "string" && parsed.stdout.trim()) lines.push(`stdout: ${truncate(parsed.stdout, 400)}`);

  return lines;
}

export function compactObservationForGraph(candidate) {
  const observation = candidate.observation || candidate;
  const rawNarrative = textOf(observation.narrative);
  const parsed = tryParseJson(rawNarrative) || extractLooseJsonFields(rawNarrative);
  const generated = diffSummary(parsed);
  const narrative = generated.length > 0
    ? generated.join("\n")
    : truncate(rawNarrative, 1600);

  return {
    id: observation.id,
    type: observation.type,
    title: observation.title,
    narrative,
    concepts: asArray(observation.concepts),
    files: asArray(observation.files),
  };
}

function inferLibraries(text, concepts) {
  const haystack = `${text}\n${concepts.join("\n")}`;
  return LIBRARY_NAMES.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack));
}

function mergeSourceIds(existing, extra) {
  return uniq([...asArray(existing), ...asArray(extra)].filter((id) => typeof id === "string" && id.length > 0));
}

export function buildDeterministicGraph(sessionCandidates, options = {}) {
  const existingNodes = asArray(options.existingGraphNodes);
  const existingEdges = asArray(options.existingGraphEdges);
  const nodeByKey = new Map();
  const edgeByKey = new Map();

  for (const node of existingNodes) {
    if (node?.type && node?.name) nodeByKey.set(`${node.type}:${node.name}`, { ...node });
  }
  for (const edge of existingEdges) {
    if (edge?.sourceNodeId && edge?.targetNodeId && edge?.type) {
      edgeByKey.set(`${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`, { ...edge });
    }
  }

  const touchedNodeIds = new Set();
  const touchedEdgeIds = new Set();
  const now = new Date().toISOString();

  function upsertNode(type, name, sourceObservationIds, properties = {}) {
    if (!name) return null;
    const key = `${type}:${name}`;
    const existing = nodeByKey.get(key);
    if (existing) {
      existing.sourceObservationIds = mergeSourceIds(existing.sourceObservationIds, sourceObservationIds);
      existing.properties = { ...(existing.properties || {}), ...properties };
      nodeByKey.set(key, existing);
      touchedNodeIds.add(existing.id);
      return existing;
    }
    const node = {
      id: stableId("gn", [type, name]),
      type,
      name,
      properties,
      sourceObservationIds: mergeSourceIds([], sourceObservationIds),
      createdAt: now,
    };
    nodeByKey.set(key, node);
    touchedNodeIds.add(node.id);
    return node;
  }

  function upsertEdge(type, sourceNode, targetNode, sourceObservationIds, weight = 0.65) {
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return null;
    const key = `${sourceNode.id}|${targetNode.id}|${type}`;
    const existing = edgeByKey.get(key);
    if (existing) {
      existing.sourceObservationIds = mergeSourceIds(existing.sourceObservationIds, sourceObservationIds);
      existing.weight = Math.max(existing.weight || 0, weight);
      edgeByKey.set(key, existing);
      touchedEdgeIds.add(existing.id);
      return existing;
    }
    const edge = {
      id: stableId("ge", [type, sourceNode.id, targetNode.id]),
      type,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      weight,
      sourceObservationIds: mergeSourceIds([], sourceObservationIds),
      createdAt: now,
    };
    edgeByKey.set(key, edge);
    touchedEdgeIds.add(edge.id);
    return edge;
  }

  for (const candidate of sessionCandidates) {
    const sourceIds = asArray(candidate.sourceObservationIds).length > 0 ? candidate.sourceObservationIds : [candidate.id];
    const projectName = sessionLabel(candidate.session, candidate.sessionId || candidate.id);
    const projectNode = upsertNode("concept", projectName, sourceIds, {
      kind: "project",
      sessionId: candidate.sessionId || "",
    });

    const conceptNodes = uniq(asArray(candidate.concepts).filter((concept) => typeof concept === "string" && concept.trim().length > 0))
      .slice(0, 18)
      .map((concept) => upsertNode(inferLibraries(concept, [concept]).length > 0 ? "library" : "concept", concept.trim(), sourceIds));

    const libraryNodes = inferLibraries(candidate.narrative || "", asArray(candidate.concepts))
      .map((name) => upsertNode("library", name, sourceIds));

    const fileNodes = uniq(asArray(candidate.files).map(displayFilePath).filter(Boolean))
      .slice(0, 14)
      .map((file) => upsertNode("file", file, sourceIds));

    for (const fileNode of fileNodes) {
      upsertEdge("related_to", projectNode, fileNode, sourceIds, 0.75);
      for (const libraryNode of libraryNodes) upsertEdge("imports", fileNode, libraryNode, sourceIds, 0.72);
      for (const conceptNode of conceptNodes) upsertEdge("related_to", fileNode, conceptNode, sourceIds, 0.6);
    }
    for (const conceptNode of conceptNodes) upsertEdge("related_to", projectNode, conceptNode, sourceIds, 0.62);
    for (const libraryNode of libraryNodes) upsertEdge("uses", projectNode, libraryNode, sourceIds, 0.7);
  }

  return {
    graphNodes: [...nodeByKey.values()].filter((node) => touchedNodeIds.has(node.id)),
    graphEdges: [...edgeByKey.values()].filter((edge) => touchedEdgeIds.has(edge.id)),
  };
}

async function writeOutput(path, payload) {
  if (!path) return;
  const abs = resolve(path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(payload, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const exportData = await loadExportData(options);
  const selected = options.mode === "session" || options.mode === "deterministic" ? buildSessionCandidates(exportData, options) : selectCandidates(exportData, options);
  const progress = await loadProgress(options.progressPath, options.resetProgress);
  const processed = new Set(progress.processed);
  const pending = selected.candidates.filter((candidate) => !processed.has((candidate.observation || candidate).id));
  const statsBefore = await loadGraphStats(options.viewerUrl).catch((error) => ({ error: error.message }));

  const report = {
    mode: options.run ? "run" : "dry-run",
    candidateMode: options.mode,
    selected: selected.candidates.length,
    pending: pending.length,
    processed: processed.size,
    selectionStats: selected.stats,
    summary: summarizeCandidates(selected.candidates),
    graphStatsBefore: statsBefore,
    topCandidates: selected.candidates.slice(0, 25).map(candidateReport),
  };

  await writeOutput(options.output, {
    ...report,
    candidates: selected.candidates.map(candidateReport),
  });

  console.log(JSON.stringify(report, null, 2));

  if (!options.run) {
    console.error("\nDry-run only. Add --run to call /agentmemory/graph/extract through the direct REST API.");
    return;
  }

  if (options.mode === "deterministic") {
    const graph = buildDeterministicGraph(pending, {
      existingGraphNodes: asArray(exportData.graphNodes),
      existingGraphEdges: asArray(exportData.graphEdges),
    });
    const result = await postImport(options.restUrl, options.secret, {
      version: exportData.version || "0.9.11",
      sessions: [],
      observations: {},
      memories: [],
      summaries: [],
      graphNodes: graph.graphNodes,
      graphEdges: graph.graphEdges,
    });
    for (const candidate of pending) processed.add(candidate.id);
    await saveProgress(options.progressPath, processed);
    const statsAfter = await loadGraphStats(options.viewerUrl).catch((error) => ({ error: error.message }));
    console.log(JSON.stringify({
      mode: "deterministic-import-complete",
      importedNodes: graph.graphNodes.length,
      importedEdges: graph.graphEdges.length,
      result,
      processed: processed.size,
      graphStatsAfter: statsAfter,
    }, null, 2));
    return;
  }

  for (let index = 0; index < pending.length; index += options.batchSize) {
    const batch = pending.slice(index, index + options.batchSize);
    const observations = batch.map(compactObservationForGraph);
    const result = await postGraphExtract(options.restUrl, options.secret, observations);
    for (const candidate of batch) processed.add((candidate.observation || candidate).id);
    await saveProgress(options.progressPath, processed);
    console.error(JSON.stringify({
      batch: `${Math.floor(index / options.batchSize) + 1}/${Math.ceil(pending.length / options.batchSize)}`,
      observationIds: observations.map((observation) => observation.id),
      result,
    }));
    if (options.sleepMs > 0 && index + options.batchSize < pending.length) await sleep(options.sleepMs);
  }

  const statsAfter = await loadGraphStats(options.viewerUrl).catch((error) => ({ error: error.message }));
  console.log(JSON.stringify({
    mode: "run-complete",
    processed: processed.size,
    graphStatsAfter: statsAfter,
  }, null, 2));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
