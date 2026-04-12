import { createProjectBrainLayout } from "../lib/layout.js";
import { loadKnowledge } from "./memory-engine.js";
import { summarizePlan } from "./plan-engine.js";
import { writeJsonFile } from "../lib/storage.js";

function buildPlanSnapshot(plan, context) {
  if (plan) {
    return summarizePlan(plan);
  }

  return {
    goalId: context?.goal?.id ?? null,
    revision: null,
    status: null,
    strategy: null,
    openSteps: [],
    latestDecisions: [],
    openIssues: []
  };
}

export async function syncProjectBrain({ projectRoot, context, plan, sessionSummary, syncConflicts = null, repositoryLayout }) {
  if (!projectRoot) {
    return null;
  }

  const localBrain = await createProjectBrainLayout(projectRoot);
  const globalKnowledge = await loadKnowledge(repositoryLayout, "global");
  const projectKnowledge = await loadKnowledge(repositoryLayout, "project");

  await writeJsonFile(localBrain.contextFile, {
    generatedAt: new Date().toISOString(),
    context
  });

  // .pcpm gets the merged view (global + project) so agents have full context
  const mergedEntries = [
    ...(globalKnowledge.entries ?? []),
    ...(projectKnowledge.entries ?? [])
  ];

  await writeJsonFile(localBrain.knowledgeSummaryFile, {
    generatedAt: new Date().toISOString(),
    entries: mergedEntries
  });

  await writeJsonFile(localBrain.latestPlanFile, buildPlanSnapshot(plan, context));

  if (sessionSummary) {
    await writeJsonFile(localBrain.sessionSummaryFile, sessionSummary);
  }

  if (syncConflicts) {
    await writeJsonFile(localBrain.syncConflictFile, {
      updatedAt: new Date().toISOString(),
      conflicts: syncConflicts
    });
  }

  return localBrain;
}
