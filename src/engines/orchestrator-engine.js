/**
 * ==============================================================================
 * DATEI: src/engines/orchestrator-engine.js
 * PROJEKT: Infra-SIN-Global-Brain
 * ZWECK: HAUPT-Orchestrierung - Koordiniert ALLE Brain-Aktivitäten
 * 
 * WICHTIG FÜR ENTWICKLER:
 * Dies ist das GEHIRN des Gehirns. Diese Funktion wird von Agenten aufgerufen,
 * um komplexe Aufgaben zu planen, auszuführen und zu reflektieren.
 * 
 * ACHTUNG: Diese Datei ist KRITISCH. Ein Fehler hier legt das gesamte System lahm.
 * Teste JEDE Änderung gründlich, bevor du sie committest.
 * 
 * ABLAUF DER ORCHESTRIERUNG (SCHRITT FÜR SCHRITT):
 * 1. Ziel sicherstellen (Goal Engine)
 * 2. Plan laden oder erstellen (Plan Engine)
 * 3. Session-Nachricht speichern (Session Engine)
 * 4. Wissen laden (Memory Engine)
 * 5. Optional: GraphRAG-Suche für Kontext
 * 6. Aktiven Kontext aufbauen (Context Engine)
 * 7. Prompt für Ausführung bauen (Execution Prompt)
 * 8. Code ausführen lassen (OpenCode Runner)
 * 9. Plan aktualisieren (Plan Engine)
 * 10. Memory updaten (Memory Engine)
 * 11. Reflexion durchführen (Reflection Engine)
 * 12. Session zusammenfassen (Session Engine)
 * 13. Strategie bewerten (Meta-Learning Engine)
 * 14. Mit globalem Brain synchronisieren (Bidi-Sync Engine)
 * ==============================================================================
 */

import { createRepositoryLayout } from "../lib/layout.js";
import { writeJsonFile } from "../lib/storage.js";
import { buildActiveContext, buildExecutionPrompt, buildRetrievalPlan } from "./context-engine.js";
import {
  assertStrategyIsNotForbidden,
  buildDryRunExecution,
  validateExecutionResult
} from "./control-engine.js";
import { ensureGoal } from "./goal-engine.js";
import { applyMemoryUpdate, loadMergedKnowledge } from "./memory-engine.js";
import { OpenCodeRunner } from "./opencode-runner.js";
import { applyPlanUpdate, loadLatestPlan, savePlanVersion, buildInitialPlan } from "./plan-engine.js";
import { reflectExecution } from "./reflection-engine.js";
import { appendSessionMessage, buildSessionSummary, loadSessionMessages, writeSessionSummary, loadSessionSummary } from "./session-engine.js";
import { scoreStrategy } from "./meta-learning-engine.js";
import { bidirectionalSync } from "./bidi-sync-engine.js";
import { searchGraphRAG } from "./graphrag-engine.js";

/**
 * FUNKTION: runOrchestration
 * 
 * WAS MACHT SIE: Dies ist die HAUPTFUNKTION des gesamten Global Brain Systems.
 * Sie koordiniert den kompletten Lebenszyklus einer Aufgabe von der Planung
 * bis zur Reflexion und Speicherung der Erkenntnisse.
 * 
 * PARAMETER:
 * - rootDir: Wurzelverzeichnis des Projekts (Standard: aktuelles Verzeichnis)
 * - projectId: EINDEUTIGE ID für das Projekt (KRITISCH!)
 * - projectRoot: Pfad zum eigentlichen Projektcode
 * - goalId: ID des Ziels (wenn nicht angegeben, wird eines erstellt)
 * - goalDescription: Beschreibung des Ziels in natürlicher Sprache
 * - task: Die konkrete Aufgabe, die ausgeführt werden soll
 * - sessionId: ID für die Session (automatisch generiert wenn nicht angegeben)
 * - constraints: Array von Einschränkungen/Regeln für die Ausführung
 * - executionResult: Vorab-Ergebnis (für Tests oder externe Ausführung)
 * - runner: Custom Runner (Standard: OpenCodeRunner)
 * - dryRun: Wenn true, wird nichts wirklich ausgeführt (nur Simulation)
 * - skipReflection: Wenn true, wird keine Reflexion durchgeführt (spart Zeit)
 * 
 * RÜCKGABEWERT: Objekt mit allen Ergebnissen der Orchestrierung
 * - layout: Das Repository-Layout
 * - goal: Das verwendete Ziel
 * - prompt: Der generierte Prompt
 * - planBefore/planAfter: Plan vor/nach der Ausführung
 * - executionResult: Ergebnis der Code-Ausführung
 * - reflection: Reflexions-Ergebnis
 * - sessionSummary: Zusammenfassung der Session
 * - contextBefore/contextAfter: Kontext vor/nach der Ausführung
 * - localProjectBrain: Ergebnis der Synchronisation mit lokalem Brain
 * 
 * ACHTUNG: Diese Funktion kann mehrere Minuten laufen! Sie ruft LLMs auf,
 * führt Code aus und schreibt viele Dateien. Geduld ist wichtig.
 */
export async function runOrchestration({
  rootDir = process.cwd(),
  projectId,
  projectRoot = null,
  goalId,
  goalDescription,
  task,
  sessionId = `session-${Date.now()}`,
  constraints = [],
  executionResult = null,
  runner = null,
  dryRun = false,
  skipReflection = false
}) {
  // SCHRITT 1: Repository-Layout erstellen/laden
  // WAS PASSIERT HIER: Erstellt die standardisierte Ordnerstruktur für das Brain
  // WARUM WICHTIG: Alle anderen Funktionen erwarten diese Struktur
  const layout = await createRepositoryLayout({ rootDir, projectId });
  
  // SCHRITT 2: Ziel sicherstellen
  // WAS PASSIERT HIER: Lädt existierendes Ziel oder erstellt neues
  // KRITISCH: Ohne Ziel weiß der Agent nicht, worauf er hinarbeitet
  const goal = await ensureGoal(layout, {
    goalId,
    description: goalDescription,
    constraints
  });

  // SCHRITT 3: Plan laden oder initialen Plan erstellen
  // WAS PASSIERT HIER: Versucht existierenden Plan zu laden
  // FALLBACK: Wenn kein Plan existiert, wird ein neuer Initialplan erstellt
  let planBefore = await loadLatestPlan(layout, goal.id);

  if (!planBefore) {
    // KEIN PLAN VORHANDEN - Erstelle ersten Plan
    // WAS PASSIERT HIER: Baut einen Basisplan mit Strategie und Meilensteinen
    planBefore = buildInitialPlan({
      projectId: layout.projectId,
      goalId: goal.id,
      goalDescription,
      constraints
    });
    await savePlanVersion(layout, planBefore);
  }

  // SCHRITT 4: User-Task in Session speichern
  // WAS PASSIERT HIER: Protokolliert die Benutzereingabe für spätere Analyse
  // NÜTZLICH: Ermöglicht Nachverfolgung und Lernen aus vergangenen Tasks
  await appendSessionMessage(layout, {
    sessionId,
    role: "user",
    text: task,
    metadata: {
      goalId: goal.id,
      eventType: "task"
    }
  });

  // SCHRITT 5: Vorheriges Wissen laden
  // WAS PASSIERT HIER: Lädt alle gespeicherten Erkenntnisse aus früheren Sessions
  // POWER-FEATURE: Der Agent lernt aus Erfahrung und wiederholt Fehler nicht
  const knowledgeBefore = await loadMergedKnowledge(layout);
  
  // SCHRITT 6: Session-Zusammenfassung laden
  // WAS PASSIERT HIER: Lädt Kurzbeschreibung der letzten Session
  // SPART ZEIT: Statt ganzer Historie reicht oft die Zusammenfassung
  const previousSessionSummary = await loadSessionSummary(layout, sessionId);

  // SCHRITT 7: Optional GraphRAG-Suche
  // WAS PASSIERT HIER: Durchsucht Wissensgraph nach relevanten Zusammenhängen
  // WANN AKTIV: Nur wenn ENABLE_GRAPHRAG=true gesetzt ist
  // LEISTUNG: Kann teuer sein, aber liefert bessere Kontext-Ergebnisse
  let graphRagResults = null;
  if (process.env.ENABLE_GRAPHRAG === 'true') {
    try {
      const retrievalPlan = buildRetrievalPlan(task, {
        goal,
        knowledge: knowledgeBefore,
        sessionSummary: previousSessionSummary
      });
      graphRagResults = await searchGraphRAG(layout, task, {
        intent: retrievalPlan.intent,
        maxHops: retrievalPlan.graphHops,
        topKSemantic: 20,
        topKFinal: 30
      });
      console.log(`[Orchestrator] GraphRAG returned ${graphRagResults.length} relevant entries`);
    } catch (error) {
      // FEHLERBEHANDLUNG: GraphRAG ist optional - bei Fehler einfach weitermachen
      console.warn("[Orchestrator] GraphRAG failed, proceeding without:", error.message);
      graphRagResults = null;
    }
  }

  // SCHRITT 8: Aktiven Kontext aufbauen
  // WAS PASSIERT HIER: Kombiniert Ziel, Plan, Wissen und Session zu einem Kontext
  // KRITISCH: Dieser Kontext bestimmt, wie der Agent die Aufgabe versteht
  const contextBefore = buildActiveContext({
    goal,
    plan: planBefore,
    knowledge: knowledgeBefore,
    sessionSummary: previousSessionSummary,
    options: {
      graphRagResults
    }
  });

  // SCHRITT 9: Ausführungs-Prompt generieren
  // WAS PASSIERT HIER: Baut den Prompt für den Code-generierenden LLM
  // QUALITÄT: Ein guter Prompt führt zu besserem Code
  const prompt = buildExecutionPrompt({
    goal,
    plan: planBefore,
    context: contextBefore,
    task
  });

  // SCHRITT 10: Runner initialisieren
  // WAS PASSIERT HIER: Bereitet den Code-Executor vor
  // STANDARD: OpenCodeRunner führt Code in sicherer Umgebung aus
  const activeRunner = runner ?? new OpenCodeRunner();
  
  // SCHRITT 11: Code ausführen
  // WAS PASSIERT HIER: Führt den generierten Code tatsächlich aus
  // MODI: 
  // - dryRun: Simuliert nur, ändert nichts
  // - executionResult: Verwendet vorgegebenes Ergebnis (für Tests)
  // - Normal: Führt wirklich aus via Runner
  const resolvedExecution = executionResult
    ? validateExecutionResult(executionResult)
    : dryRun
      ? buildDryRunExecution({ task, currentStrategy: planBefore.strategy })
      : validateExecutionResult(await activeRunner.runJson(prompt, { cwd: rootDir }));

  // SCHRITT 12: Plan aktualisieren
  // WAS PASSIERT HIER: Passt den Plan basierend auf dem Execution-Ergebnis an
  // LERNEN: Der Plan verbessert sich mit jeder Ausführung
  const planAfter = applyPlanUpdate(planBefore, resolvedExecution.planUpdate);
  
  // SICHERHEITSCHECK: Stelle sicher, dass neue Strategie nicht verboten ist
  // SCHUTZ: Verhindert gefährliche oder unerwünschte Aktionen
  assertStrategyIsNotForbidden(planAfter, contextBefore);
  await savePlanVersion(layout, planAfter);

  // SCHRITT 13: Memory/Knowledge updaten
  // WAS PASSIERT HIER: Speichert neue Erkenntnisse aus der Ausführung
  // GEDÄCHTNIS: Hier wird Erfahrung für zukünftige Tasks gespeichert
  const initialMemoryChanges = await applyMemoryUpdate(layout, resolvedExecution.memoryUpdate, {
    projectId: layout.projectId,
    goalId: goal.id,
    sessionId,
    sourceType: "execution"
  });

  // SCHRITT 14: Assistant-Antwort in Session speichern
  // WAS PASSIERT HIER: Protokolliert das Ergebnis für die Historie
  await appendSessionMessage(layout, {
    sessionId,
    role: "assistant",
    text: JSON.stringify(resolvedExecution),
    metadata: {
      goalId: goal.id,
      eventType: "execution-result"
    }
  });

  // SCHRITT 15: Reflexion durchführen (optional)
  // WAS PASSIERT HIER: Analysiert die Ausführung und zieht Lehren daraus
  // METAKOGNITION: Das System denkt über sein eigenes Denken nach
  let reflection = null;
  let reflectionMemoryChanges = { addedEntries: [], invalidatedEntries: [] };

  if (!skipReflection) {
    reflection = await reflectExecution({
      task,
      executionResult: resolvedExecution,
      planBefore,
      planAfter,
      contextBefore,
      runner: dryRun ? null : activeRunner,
      cwd: rootDir,
      disableLlm: dryRun
    });

    // Neue Erkenntnisse aus Reflexion speichern
    reflectionMemoryChanges = await applyMemoryUpdate(layout, reflection.memoryUpdate ?? {}, {
      projectId: layout.projectId,
      goalId: goal.id,
      sessionId,
      sourceType: "reflection"
    });
  }

  // SCHRITT 16: Session-Zusammenfassung erstellen
  // WAS PASSIERT HIER: Fasst die gesamte Session in einem kompakten Text zusammen
  // EFFIZIENZ: Zukünftige Sessions lesen nur diese Zusammenfassung statt aller Messages
  const messages = await loadSessionMessages(layout, sessionId);
  const mergedMemoryChanges = {
    addedEntries: [...initialMemoryChanges.addedEntries, ...reflectionMemoryChanges.addedEntries],
    invalidatedEntries: [
      ...initialMemoryChanges.invalidatedEntries,
      ...reflectionMemoryChanges.invalidatedEntries
    ]
  };

  const sessionSummary = buildSessionSummary({
    layout,
    sessionId,
    goalId: goal.id,
    messages,
    plan: planAfter,
    memoryChanges: mergedMemoryChanges,
    reflectionSummary: reflection?.summary ?? null,
    reflection
  });

  await writeSessionSummary(layout, sessionId, sessionSummary);

  // SCHRITT 17: Strategie bewerten
  // WAS PASSIERT HIER: Bewertet wie gut die gewählte Strategie war
  // META-LEARNING: Hilft dem System, bessere Strategien zu wählen
  if (planAfter.strategy) {
    let outcome = "partial";
    if (reflection) {
      if (reflection.qualityScore >= 0.8) outcome = "success";
      else if (reflection.qualityScore < 0.5) outcome = "failure";
    }
    await scoreStrategy(layout, planAfter.strategy, outcome);
  }

  // SCHRITT 18: Kontext nach Ausführung neu aufbauen
  // WAS PASSIERT HIER: Aktualisiert den Kontext mit neuem Wissen
  const knowledgeAfter = await loadMergedKnowledge(layout);
  const contextAfter = buildActiveContext({
    goal,
    plan: planAfter,
    knowledge: knowledgeAfter,
    sessionSummary
  });

  // SCHRITT 19: Aktuellen Kontext speichern
  // WAS PASSIERT HIER: Schreibt Kontext in Datei für schnellen Zugriff
  await writeJsonFile(layout.projectActiveContextFile, {
    generatedAt: new Date().toISOString(),
    context: contextAfter
  });

  // SCHRITT 20: Mit lokalem Project Brain synchronisieren
  // WAS PASSIERT HIER: Überträgt Erkenntnisse ins lokale Projekt-Brain
  // BRIDGE: Verbindet globales Brain mit lokalem Code
  const localProjectBrain = await bidirectionalSync({
    projectRoot,
    context: contextAfter,
    plan: planAfter,
    sessionSummary,
    repositoryLayout: layout
  });

  // RÜCKGABE: Alle Ergebnisse der Orchestrierung
  return {
    layout,
    goal,
    prompt,
    planBefore,
    planAfter,
    executionResult: resolvedExecution,
    reflection,
    graphSummary: reflectionMemoryChanges.graphSummary ?? initialMemoryChanges.graphSummary ?? null,
    sessionSummary,
    contextBefore,
    contextAfter,
    localProjectBrain
  };
}
