import path from "node:path";
import { readJsonFile, writeJsonFile, ensureDir } from "../lib/storage.js";
import { loadMergedKnowledge } from "./memory-engine.js";

async function loadMetaScores(layout) {
  const file = path.join(layout.globalRoot, "meta-scores.json");
  return readJsonFile(file, { scores: [] });
}

async function saveMetaScores(layout, data) {
  const file = path.join(layout.globalRoot, "meta-scores.json");
  await writeJsonFile(file, data);
}

export async function scoreStrategy(layout, strategy, outcome) {
  const data = await loadMetaScores(layout);
  const now = new Date().toISOString();
  
  const scoreMap = {
    success: 1.0,
    partial: 0.6,
    failure: 0.2
  };
  
  const scoreValue = scoreMap[outcome] ?? 0.5;

  let entry = data.scores.find((s) => s.strategy === strategy);
  
  if (entry) {
    entry.score = (entry.score * entry.runs + scoreValue) / (entry.runs + 1);
    entry.runs += 1;
    entry.lastUsed = now;
  } else {
    entry = {
      strategy,
      score: scoreValue,
      runs: 1,
      goalType: "general",
      lastUsed: now
    };
    data.scores.push(entry);
  }

  await saveMetaScores(layout, data);
  return entry.score;
}

export async function getBestStrategy(layout, goalType = "general") {
  const data = await loadMetaScores(layout);
  return data.scores
    .filter((s) => s.goalType === goalType)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function suggestImprovement(layout, lastStrategy) {
  const knowledge = await loadMergedKnowledge(layout);
  const rules = knowledge.active.filter((k) => k.type === "rule");
  
  if (rules.length === 0) {
    return [];
  }
  
  // Return the highest scored rules as suggestions
  return rules
    .sort((a, b) => b.score - a.score)
    .map((r) => r.text);
}
