import { validateExecutionResult } from "./control-engine.js";

export function buildReflectionPrompt({ task, executionResult, planBefore, planAfter, contextBefore }) {
  return [
    "SYSTEM:",
    "You are reviewing a coding step for persistent memory extraction.",
    "Return valid JSON only.",
    "",
    "TASK:",
    task,
    "",
    "PLAN BEFORE:",
    JSON.stringify(planBefore, null, 2),
    "",
    "PLAN AFTER:",
    JSON.stringify(planAfter, null, 2),
    "",
    "CONTEXT BEFORE:",
    JSON.stringify(contextBefore, null, 2),
    "",
    "EXECUTION RESULT:",
    JSON.stringify(executionResult, null, 2),
    "",
    "OUTPUT SCHEMA:",
    JSON.stringify(
      {
        summary: "brief reflection summary",
        qualityScore: 0.82,
        suggestions: ["specific next improvement"],
        memoryUpdate: {
          facts: ["validated fact"],
          mistakes: ["repeatable mistake to avoid"],
          solutions: ["solution that worked"],
          rules: ["cross-project rule"],
          invalidations: [
            {
              matchText: "obsolete text",
              reason: "why it is obsolete"
            }
          ]
        }
      },
      null,
      2
    )
  ].join("\n");
}

function buildFallbackReflection({ task, executionResult, planBefore, planAfter }) {
  const strategyChanged = planBefore.strategy !== planAfter.strategy;
  const facts = [`Latest result summary: ${executionResult.resultSummary}`];
  const mistakes = [];
  const rules = [];
  const suggestions = [];
  let qualityScore = 0.72;

  if (/error|failed|exception|timeout/iu.test(executionResult.resultSummary)) {
    mistakes.push(`Execution encountered a potential failure signal: ${executionResult.resultSummary}`);
    suggestions.push("Add stronger validation before reusing this strategy.");
    qualityScore = 0.42;
  }

  if (strategyChanged) {
    facts.push(`Strategy changed from ${planBefore.strategy} to ${planAfter.strategy}.`);
    rules.push("When strategy changes, invalidate the superseded strategy before the next run.");
    suggestions.push("Review whether earlier strategy-specific steps should be invalidated.");
  }

  return {
    summary: `Fallback reflection completed for task: ${task}`,
    qualityScore,
    suggestions,
    memoryUpdate: {
      facts,
      mistakes,
      rules
    }
  };
}

export async function reflectExecution({
  task,
  executionResult,
  planBefore,
  planAfter,
  contextBefore,
  runner,
  cwd = process.cwd(),
  disableLlm = false
}) {
  if (disableLlm || !runner) {
    return buildFallbackReflection({ task, executionResult, planBefore, planAfter });
  }

  try {
    const prompt = buildReflectionPrompt({ task, executionResult, planBefore, planAfter, contextBefore });
    const response = await runner.runJson(prompt, { cwd });

    return {
      summary: response.summary ?? `Reflection completed for task: ${task}`,
      qualityScore: Number.isFinite(Number(response.qualityScore)) ? Number(response.qualityScore) : 0.75,
      suggestions: Array.isArray(response.suggestions) ? response.suggestions.map(String) : [],
      memoryUpdate: validateExecutionResult({
        resultSummary: "reflection-wrapper",
        planUpdate: {},
        memoryUpdate: response.memoryUpdate ?? {}
      }).memoryUpdate
    };
  } catch {
    return buildFallbackReflection({ task, executionResult, planBefore, planAfter });
  }
}
