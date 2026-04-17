/**
 * perception-engine.js — Phase IV: Perception Agent
 *
 * Der Perception Agent ist der erste Schritt im 7-Agenten-Modell.
 * Er "sieht" alle eingehenden Events (Session-Messages, System-Events, Errors)
 * und filtert/klassifiziert sie für die weiteren Agenten.
 *
 * Responsibilities:
 * - Ingest raw events from orchestrator, session engine, system logs
 * - Filter noise (irrelevant, duplicate, low-signal events)
 * - Classify event types: user_input, agent_output, error, plan_update, memory_update, system_alert
 * - Extract structured signals: intent, sentiment, urgency, entities
 * - Forward relevant events to Insight Agent (for pattern detection)
 * - Forward alerts to Alert Agent (for threshold monitoring)
 * - Publish to event bus for other agents
 *
 * @module perception-engine
 */

import { loadSessionMessages } from "./session-engine.js";

const EVENT_TYPES = {
  USER_INPUT: "user_input",
  AGENT_OUTPUT: "agent_output",
  ERROR: "error",
  PLAN_UPDATE: "plan_update",
  MEMORY_UPDATE: "memory_update",
  SYSTEM_ALERT: "system_alert",
  UNKNOWN: "unknown"
};

/**
 * Process a single event (message or system event)
 *
 * @param {Object} event - Raw event object
 * @param {Object} context - Current orchestration context
 * @returns {Promise<Object>} Filtered, classified event
 */
export async function perceiveEvent(event, context = {}) {
  const classified = classifyEvent(event);
  const filtered = await filterNoise(classified);
  const enriched = await enrichWithSignals(filtered);
  
  // Publish to event bus (in future: Neural-Bus integration)
  // await publishToEventBus(enriched);

  return enriched;
}

/**
 * Classify an event into a type and extract basic metadata
 *
 * @param {Object} event - Raw event
 * @returns {Object} Classified event with type, timestamp, source
 */
function classifyEvent(event) {
  let type = EVENT_TYPES.UNKNOWN;
  let source = event.source ?? "system";
  let severity = "info";

  // Determine event type based on characteristics
  if (event.role === "user") {
    type = EVENT_TYPES.USER_INPUT;
    source = "user";
  } else if (event.role === "assistant") {
    type = EVENT_TYPES.AGENT_OUTPUT;
  } else if (event.eventType) {
    switch (event.eventType) {
      case "error":
      case "exception":
        type = EVENT_TYPES.ERROR;
        severity = "error";
        break;
      case "plan_update":
        type = EVENT_TYPES.PLAN_UPDATE;
        break;
      case "memory_update":
        type = EVENT_TYPES.MEMORY_UPDATE;
        break;
      case "system_alert":
        type = EVENT_TYPES.SYSTEM_ALERT;
        severity = "warning";
        break;
    }
  }

  return {
    ...event,
    type,
    source,
    severity,
    classifiedAt: new Date().toISOString()
  };
}

/**
 * Filter out noise events that don't need downstream processing
 *
 * @param {Object} event - Classified event
 * @returns {Promise<Object>} Filtered event or null if should be dropped
 */
async function filterNoise(event) {
  // Drop trivial system messages (unless they're errors/alerts)
  if (event.type === EVENT_TYPES.AGENT_OUTPUT) {
    const text = String(event.text ?? "");
    // Skip "I'll help you" type filler
    if (text.length < 10 && /^(\s*I[''']ll|Sure|Okay|Got it)/i.test(text)) {
      return null;
    }
  }

  // Duplicate detection: skip if very similar to recent event
  // This would need a short-term memory buffer; placeholders TODO

  return event;
}

/**
 * Enrich event with extracted signals (intent, entities, urgency)
 *
 * @param {Object} event - Filtered event
 * @returns {Promise<Object>} Enriched event with signals
 */
async function enrichWithSignals(event) {
  const text = String(event.text ?? event.content ?? "");
  const signals = {
    intent: null,
    sentiment: "neutral",
    urgency: "normal",
    entities: []
  };

  if (text.length > 0) {
    // Simple keyword-based intent extraction (can be upgraded with LLM)
    signals.intent = detectIntentFromText(text);
    signals.sentiment = analyzeSentiment(text);
    signals.urgency = detectUrgency(text);
    signals.entities = extractEntities(text);
  }

  return {
    ...event,
    signals
  };
}

/**
 * Detect intent from text using keyword patterns
 */
function detectIntentFromText(text) {
  const lower = text.toLowerCase();
  if (/error|fail|crash|bug|issue|problem/.test(lower)) return "troubleshooting";
  if (/create|build|implement|add|new/.test(lower)) return "creation";
  if (/refactor|optimize|improve|clean/.test(lower)) return "refactoring";
  if (/deploy|release|publish/.test(lower)) return "deployment";
  if (/security|vulnerability|cve|auth|token/.test(lower)) return "security";
  return "general";
}

/**
 * Simple sentiment analysis (positive/negative/neutral)
 */
function analyzeSentiment(text) {
  const positive = /good|great|success|working|perfect|excellent/.test(text.toLowerCase());
  const negative = /bad|fail|error|issue|problem|broken/.test(text.toLowerCase());
  if (positive) return "positive";
  if (negative) return "negative";
  return "neutral";
}

/**
 * Detect urgency from text cues
 */
function detectUrgency(text) {
  const lower = text.toLowerCase();
  if (/urgent|asap|immediately|critical|emergency/.test(lower)) return "high";
  if (/low priority|whenever|no rush/.test(lower)) return "low";
  return "normal";
}

/**
 * Extract entities (simple: capitalized words, code snippets, URLs)
 */
function extractEntities(text) {
  const entities = [];
  // URLs
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  entities.push(...urls.map(u => ({ type: "url", value: u })));
  // File paths
  const paths = text.match(/(~?\/[\w\/.\-]+|\w:\\[\w\\.\-]+)/g) ?? [];
  entities.push(...paths.map(p => ({ type: "path", value: p })));
  // Code snippets (backticks)
  const code = text.match(/`([^`]+)`/g) ?? [];
  entities.push(...code.map(c => ({ type: "code", value: c.slice(1, -1) })));
  return entities;
}

/**
 * Batch process events from a session
 *
 * @param {Object[]} events - Array of raw events
 * @param {Object} context - Context object
 * @returns {Promise<Object[]>} Processed events
 */
export async function processEventBatch(events, context = {}) {
  const results = [];
  for (const event of events) {
    const processed = await perceiveEvent(event, context);
    if (processed) {
      results.push(processed);
    }
  }
  return results;
}

/**
 * Get recent session events (convenience wrapper)
 *
 * @param {Object} layout - PCPM layout
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object[]>} Processed events
 */
export async function getSessionEvents(layout, sessionId) {
  const rawMessages = await loadSessionMessages(layout, sessionId);
  const rawEvents = rawMessages.map(msg => ({
    role: msg.role,
    text: msg.text,
    timestamp: msg.timestamp,
    source: "session"
  }));
  return processEventBatch(rawEvents);
}
