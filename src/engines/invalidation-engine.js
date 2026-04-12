import { uniqueStrings } from "../lib/storage.js";

const REPLACEMENT_HINTS = [
  "switch",
  "switched",
  "replace",
  "replaced",
  "supersede",
  "superseded",
  "obsolete",
  "deprecated",
  "deprecate",
  "retire",
  "retired",
  "migrate",
  "migrated",
  "no longer",
  "stop using",
  "forbidden",
  "avoid"
];

function normalizeScore(value, fallback = 1) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasReplacementSignal(entry) {
  const haystack = [entry.text, entry.rationale, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return Boolean(entry.replacesTopic) || REPLACEMENT_HINTS.some((hint) => haystack.includes(hint));
}

function canAffectEntry(sourceEntry, targetEntry) {
  if (sourceEntry.id === targetEntry.id || targetEntry.status !== "active") {
    return false;
  }

  if (sourceEntry.scope === "global") {
    return true;
  }

  return targetEntry.scope === sourceEntry.scope;
}

export function enrichKnowledgeEntry(entry) {
  return {
    ...entry,
    score: normalizeScore(entry.score, 1),
    driftStatus: entry.driftStatus ?? "fresh",
    driftReasons: uniqueStrings(entry.driftReasons),
    lastValidatedAt: entry.lastValidatedAt ?? entry.updatedAt ?? entry.createdAt ?? new Date().toISOString()
  };
}

export function decayKnowledgeEntries(entries, { now = new Date() } = {}) {
  return entries.map((entry) => {
    const enrichedEntry = enrichKnowledgeEntry(entry);

    if (enrichedEntry.status !== "active") {
      return enrichedEntry;
    }

    const lastTouch = parseTimestamp(enrichedEntry.updatedAt ?? enrichedEntry.createdAt);

    if (lastTouch === null) {
      return enrichedEntry;
    }

    const ageDays = Math.max(0, (now.getTime() - lastTouch) / 86400000);
    const nextScore = normalizeScore(enrichedEntry.score * Math.pow(0.995, Math.min(ageDays, 180)));

    return {
      ...enrichedEntry,
      score: nextScore,
      ageDays: Number(ageDays.toFixed(2))
    };
  });
}

export function annotateKnowledgeDrift(entries, { now = new Date(), warningDays = 21, staleDays = 45, lowScoreThreshold = 0.45 } = {}) {
  return entries.map((entry) => {
    const enrichedEntry = enrichKnowledgeEntry(entry);

    if (enrichedEntry.status !== "active") {
      return {
        ...enrichedEntry,
        driftStatus: "invalidated",
        driftReasons: uniqueStrings([...(enrichedEntry.driftReasons ?? []), "invalidated"])
      };
    }

    const lastTouch = parseTimestamp(enrichedEntry.updatedAt ?? enrichedEntry.createdAt);
    const ageDays = lastTouch === null ? 0 : Math.max(0, (now.getTime() - lastTouch) / 86400000);
    const driftReasons = [];

    if (ageDays >= staleDays) {
      driftReasons.push("stale-age");
    } else if (ageDays >= warningDays) {
      driftReasons.push("aging");
    }

    if (enrichedEntry.score <= lowScoreThreshold) {
      driftReasons.push("low-score");
    }

    return {
      ...enrichedEntry,
      ageDays: Number(ageDays.toFixed(2)),
      driftStatus: driftReasons.includes("stale-age") && driftReasons.includes("low-score")
        ? "stale"
        : driftReasons.length > 0
          ? "watch"
          : "fresh",
      driftReasons: uniqueStrings(driftReasons)
    };
  });
}

export function deriveAutomaticInvalidations(addedEntries, existingEntries) {
  const invalidations = [];

  for (const addedEntry of addedEntries) {
    if (!addedEntry || addedEntry.status !== "active") {
      continue;
    }

    const normalizedAddedText = String(addedEntry.text ?? "").trim().toLowerCase();

    for (const existingEntry of existingEntries) {
      if (!canAffectEntry(addedEntry, existingEntry)) {
        continue;
      }

      if (addedEntry.type === "forbidden" && normalizedAddedText && normalizedAddedText === String(existingEntry.text ?? "").trim().toLowerCase()) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `Forbidden entry ${addedEntry.id} superseded ${existingEntry.id}`
        });
        continue;
      }

      if (!addedEntry.topic || addedEntry.topic !== existingEntry.topic || addedEntry.text === existingEntry.text) {
        continue;
      }

      if (addedEntry.type === existingEntry.type && (addedEntry.replacesTopic || hasReplacementSignal(addedEntry))) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `${addedEntry.type} ${addedEntry.id} superseded topic ${addedEntry.topic}`
        });
        continue;
      }

      if (["decision", "rule", "forbidden"].includes(addedEntry.type) && hasReplacementSignal(addedEntry)) {
        invalidations.push({
          matchId: existingEntry.id,
          scope: existingEntry.scope,
          reason: `${addedEntry.type} ${addedEntry.id} contradicted topic ${addedEntry.topic}`
        });
      }
    }
  }

  return invalidations;
}

export function buildForbiddenList(entries, { scope = "all" } = {}) {
  return entries
    .filter((entry) => entry.type === "forbidden" && entry.status === "active")
    .filter((entry) => scope === "all" || entry.scope === "global" || entry.scope === scope)
    .sort((left, right) => {
      const scoreDelta = normalizeScore(right.score, 1) - normalizeScore(left.score, 1);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });
}

export function buildConflictCandidates(existingEntries, incomingEntries) {
  const conflicts = [];

  for (const incomingEntry of incomingEntries) {
    if (!incomingEntry?.topic || incomingEntry.status !== "active") {
      continue;
    }

    const conflictingEntry = existingEntries.find(
      (existingEntry) =>
        existingEntry.status === "active" &&
        existingEntry.type === incomingEntry.type &&
        existingEntry.topic === incomingEntry.topic &&
        existingEntry.text !== incomingEntry.text
    );

    if (conflictingEntry) {
      conflicts.push({
        existingEntry: conflictingEntry,
        incomingEntry
      });
    }
  }

  return conflicts;
}

export function chooseConflictWinner(existingEntry, incomingEntry) {
  const existingTimestamp = parseTimestamp(existingEntry.updatedAt ?? existingEntry.createdAt) ?? 0;
  const incomingTimestamp = parseTimestamp(incomingEntry.updatedAt ?? incomingEntry.createdAt) ?? 0;

  if (incomingTimestamp > existingTimestamp) {
    return "incoming";
  }

  if (existingTimestamp > incomingTimestamp) {
    return "existing";
  }

  if (incomingEntry.scope === "project" && existingEntry.scope !== "project") {
    return "incoming";
  }

  return "existing";
}
