/**
 * ==============================================================================
 * DATEI: src/index.js
 * PROJEKT: Infra-SIN-Global-Brain
 * ZWECK: Zentrale Export-Schnittstelle für alle Brain-Funktionen
 * 
 * WICHTIG FÜR ENTWICKLER:
 * Diese Datei ist der HAUpteinstiegspunkt für das gesamte Global Brain System.
 * Hier werden alle Module exportiert, die von anderen Projekten (wie OpenSIN-Bridge
 * oder OpenSIN-stealth-browser) verwendet werden können.
 * 
 * ACHTUNG: Ändere nichts an den Export-Namen! Andere Projekte hängen von diesen
 * exakten Bezeichnungen ab. Wenn du etwas änderst, brichst du die gesamte Integration.
 * 
 * FUNKTIONEN IM ÜBERBLICK:
 * - Layout-Erstellung: Erstellt die Ordnerstruktur für Projekte
 * - Orchestrierung: Koordiniert die Ausführung von Tasks
 * - Plan-Engine: Verwaltet Ausführungspläne
 * - Goal-Engine: Definiert und verwaltet Ziele
 * - Memory-Engine: Speichert und lädt Wissen
 * - Session-Engine: Verwaltet Chat-Sessions
 * - Sync-Engine: Synchronisiert zwischen lokalen und globalen Brains
 * ==============================================================================
 */

// Importiere Layout-Funktionen für die Ordnerstruktur
// WAS PASSIERT HIER: Erstellt standardisierte Verzeichnisstrukturen für Brain-Projekte
export { createRepositoryLayout, createProjectBrainLayout } from "./lib/layout.js";

// Importiere die Haupt-Orchestrierungsfunktion
// WAS PASSIERT HIER: Dies ist die KERNeFunktion - sie koordiniert ALLE anderen Engines
// ACHTUNG: Diese Funktion wird von Agenten direkt aufgerufen. Nicht ändern ohne Tests!
export { runOrchestration } from "./engines/orchestrator-engine.js";

// Importiere Plan-Management Funktionen
// WAS PASSIERT HIER: Erstellt, speichert und lädt Ausführungspläne für Aufgaben
// WARUM WICHTIG: Ohne Pläne weiß der Agent nicht, was er tun soll
export { buildInitialPlan, applyPlanUpdate, loadLatestPlan, savePlanVersion } from "./engines/plan-engine.js";

// Importiere Goal-Management Funktionen
// WAS PASSIERT HIER: Stellt sicher, dass Ziele definiert und geladen werden können
// ANWENDUNG: Jeder Task braucht ein klares Ziel, sonst arbeitet der Agent blind
export { ensureGoal, loadGoal } from "./engines/goal-engine.js";

// Importiere Memory/Knowledge Funktionen
// WAS PASSIERT HIER: Lädt gespeichertes Wissen und wendet neue Erkenntnisse an
// KRITISCH: Das Gedächtnis des Systems - hier wird Erfahrung gespeichert
export { loadMergedKnowledge, applyMemoryUpdate, getForbiddenKnowledge } from "./engines/memory-engine.js";

// Importiere Session-Management Funktionen
// WAS PASSIERT HIER: Verwaltet Chat-Historien und Session-Zusammenfassungen
// ANWENDUNG: Ermöglicht kontextbewusste Antworten über mehrere Interaktionen hinweg
export {
  appendSessionMessage,
  loadSessionMessages,
  loadSessionSummary,
  writeSessionSummary
} from "./engines/session-engine.js";

// Importiere Transcript-Analyse Funktionen
// WAS PASSIERT HIER: Extrahiert Wissen aus Gesprächs-Transkripten
// NÜTZLICH: Wandelt Chat-Verläufe in strukturiertes Wissen um
export { extractKnowledgeFromMessages, extractAndApplyTranscriptKnowledge } from "./engines/transcript-engine.js";

// Importiere Synchronisations-Funktionen
// WAS PASSIERT HIER: Synchronisiert lokales Projekt-Brain mit globalem Brain
// WICHTIG: Hält alle Wissensquellen konsistent und aktuell
export { pullFromProjectBrain, bidirectionalSync } from "./engines/bidi-sync-engine.js";

// Importiere Hook-Management Funktionen
// WAS PASSIERT HIER: Setzt automatische Hooks für Git-Events
// ANWENDUNG: Trigger bei Commits, Pushes, etc. für automatische Updates
export { setupProjectHooks, detectExistingHooks } from "./engines/hook-engine.js";

// Importiere Knowledge-Invalidation Funktionen
// WAS PASSIERT HIER: Erkennt und markiert veraltetes Wissen
// KRITISCH: Verhindert, dass der Agent mit alten Informationen arbeitet
export {
  annotateKnowledgeDrift,
  buildConflictCandidates,
  buildForbiddenList,
  chooseConflictWinner,
  decayKnowledgeEntries,
  deriveAutomaticInvalidations,
  enrichKnowledgeEntry
} from "./engines/invalidation-engine.js";

// Importiere Knowledge-Graph Funktionen
// WAS PASSIERT HIER: Baut und durchsucht Wissensgraphen
// POWER-FEATURE: Erkennt Zusammenhänge zwischen verschiedenen Wissensteilen
export {
  getRelatedKnowledge,
  loadKnowledgeGraph,
  summarizeKnowledgeGraph,
  updateKnowledgeGraph
} from "./engines/knowledge-graph-engine.js";
