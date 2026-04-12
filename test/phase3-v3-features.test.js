import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRepositoryLayout, createProjectBrainLayout } from "../src/lib/layout.js";
import { readJsonFile, writeJsonFile } from "../src/lib/storage.js";
import { annotateKnowledgeDrift, decayKnowledgeEntries } from "../src/engines/invalidation-engine.js";
import { loadKnowledgeGraph } from "../src/engines/knowledge-graph-engine.js";
import { applyMemoryUpdate, loadKnowledge } from "../src/engines/memory-engine.js";
import { pullFromProjectBrain } from "../src/engines/bidi-sync-engine.js";
import { syncProjectBrain } from "../src/engines/sync-engine.js";
import { setupProjectHooks } from "../src/engines/hook-engine.js";

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("automatic invalidation supersedes older same-topic decisions and records graph edges", async () => {
  const rootDir = await createTempDir("global-brain-v3-auto-");
  const layout = await createRepositoryLayout({ rootDir, projectId: "auto-invalidations" });

  const firstUpdate = await applyMemoryUpdate(layout, {
    decisions: [{ text: "Use strategy A", topic: "strategy", scope: "project" }]
  }, { sourceType: "test-initial" });

  const secondUpdate = await applyMemoryUpdate(layout, {
    decisions: [{ text: "Switch to strategy B", topic: "strategy", scope: "project" }]
  }, { sourceType: "test-replacement" });

  const projectKnowledge = await loadKnowledge(layout, "project");
  const invalidatedDecision = projectKnowledge.entries.find((entry) => entry.id === firstUpdate.addedEntries[0].id);
  const activeDecision = projectKnowledge.entries.find((entry) => entry.id === secondUpdate.addedEntries[0].id);
  const projectGraph = await loadKnowledgeGraph(layout, "project");
  const invalidationEdge = projectGraph.edges.find(
    (edge) => edge.sourceId === activeDecision.id && edge.targetId === invalidatedDecision.id && edge.relation === "invalidates"
  );

  assert.equal(invalidatedDecision.status, "invalidated");
  assert.equal(invalidatedDecision.score, 0);
  assert.equal(activeDecision.status, "active");
  assert.ok(invalidationEdge, "expected invalidation edge in project graph");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("decay and drift annotation mark old low-score knowledge as stale", async () => {
  const agedEntry = {
    id: "aged-entry",
    type: "fact",
    text: "Old operational fact",
    scope: "global",
    status: "active",
    score: 0.4,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z"
  };

  const decayedEntries = decayKnowledgeEntries([agedEntry], { now: new Date("2026-04-12T00:00:00.000Z") });
  const driftEntries = annotateKnowledgeDrift(decayedEntries, { now: new Date("2026-04-12T00:00:00.000Z") });

  assert.equal(driftEntries[0].driftStatus, "stale");
  assert.ok(driftEntries[0].driftReasons.includes("stale-age"));
  assert.ok(driftEntries[0].driftReasons.includes("low-score"));
});

test("sync conflict resolution prefers newer incoming knowledge and writes conflict reports", async () => {
  const rootDir = await createTempDir("global-brain-v3-sync-");
  const projectDir = await createTempDir("global-brain-v3-project-");
  const layout = await createRepositoryLayout({ rootDir, projectId: "sync-conflicts" });
  const localBrain = await createProjectBrainLayout(projectDir);

  await applyMemoryUpdate(layout, {
    decisions: [{ text: "Use strategy A", topic: "strategy", scope: "global", score: 0.9 }]
  }, { sourceType: "existing-global" });

  const globalKnowledgeBefore = await readJsonFile(layout.globalKnowledgeFile);
  globalKnowledgeBefore.entries = globalKnowledgeBefore.entries.map((entry) => ({
    ...entry,
    updatedAt: "2026-04-01T00:00:00.000Z"
  }));
  await writeJsonFile(layout.globalKnowledgeFile, globalKnowledgeBefore);

  await writeJsonFile(localBrain.knowledgeSummaryFile, {
    generatedAt: new Date().toISOString(),
    entries: [
      {
        id: "incoming-strategy-b",
        type: "decision",
        text: "Switch to strategy B",
        topic: "strategy",
        scope: "global",
        status: "active",
        score: 1,
        createdAt: "2026-04-12T00:00:00.000Z",
        updatedAt: "2026-04-12T00:00:00.000Z"
      }
    ]
  });

  const pullResult = await pullFromProjectBrain({ projectRoot: projectDir, repositoryLayout: layout });
  const globalKnowledgeAfter = await readJsonFile(layout.globalKnowledgeFile);
  const syncConflicts = await readJsonFile(layout.projectSyncConflictFile);
  const localConflicts = await readJsonFile(localBrain.syncConflictFile);
  const oldDecision = globalKnowledgeAfter.entries.find((entry) => entry.text === "Use strategy A");
  const newDecision = globalKnowledgeAfter.entries.find((entry) => entry.id === "incoming-strategy-b");

  assert.equal(pullResult.conflicts.length, 1);
  assert.equal(pullResult.conflicts[0].resolution, "incoming");
  assert.equal(oldDecision.status, "invalidated");
  assert.equal(newDecision.status, "active");
  assert.equal(syncConflicts.conflicts.length, 1);
  assert.equal(localConflicts.conflicts.length, 1);

  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

test("syncProjectBrain tolerates missing plan and hook setup writes project opencode config", async () => {
  const rootDir = await createTempDir("global-brain-v3-hooks-");
  const projectDir = await createTempDir("global-brain-v3-hooks-project-");
  const layout = await createRepositoryLayout({ rootDir, projectId: "hooks-live" });

  await syncProjectBrain({
    projectRoot: projectDir,
    context: { goal: { id: "goal-x" } },
    plan: null,
    sessionSummary: null,
    repositoryLayout: layout
  });

  const localBrain = await createProjectBrainLayout(projectDir);
  const planSnapshot = await readJsonFile(localBrain.latestPlanFile);
  assert.equal(planSnapshot.goalId, "goal-x");

  const hookResult = await setupProjectHooks({
    projectRoot: projectDir,
    brainRepoPath: rootDir,
    projectId: "hooks-live",
    goalId: "goal-x",
    goalDescription: "Live hook setup"
  });
  const projectConfig = await readJsonFile(hookResult.opencodeConfigFile);

  assert.equal(projectConfig.pcpm.projectId, "hooks-live");
  assert.equal(projectConfig.hooks.beforeRun, hookResult.config.hooks.beforeRun);
  assert.equal(projectConfig.hooks.afterRun, hookResult.config.hooks.afterRun);

  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});
