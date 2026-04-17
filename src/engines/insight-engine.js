/**
 * insight-engine.js — Phase IV: Insight Agent
 *
 * Der Insight Agent erkennt Muster, Anomalien und Korrelationen aus dem
 * Event-Stream, den der Perception Agent liefert. Er ist das " analytische
 * Gehirn" der 7-Agenten-Architektur.
 *
 * Responsibilities:
 * - Analyze sequences of classified events for recurring patterns
 * - Detect anomalies (deviation from established patterns)
 * - Identify correlations between different event types
 * - Generate insights: "Pattern detected: deployment failures after X", "Anomaly: error rate spiked"
 * - Feed insights to Behavior Agent (for strategy adaptation)
 * - Notify Alert Agent for critical patterns
 *
 * @module insight-engine
 */

/**
 * Run insight analysis on a batch of events
 *
 * @param {Object[]} events - Classified events from Perception Agent
 * @param {Object} options - { timeWindowMs, minSupport, anomalyThreshold }
 * @returns {Promise<Object[]>} Generated insights
 */
export async function generateInsights(events, options = {}) {
  const {
    timeWindowMs = 15 * 60 * 1000, // 15 minutes
    minSupport = 3, // Minimum occurrences to consider a pattern
    anomalyThreshold = 2.0 // Standard deviations for anomaly detection
  } = options;

  if (events.length < 2) {
    return [];
  }

  const insights = [];

  // 1. Sequential pattern mining (Apriori-like)
  const patterns = detectSequentialPatterns(events, { minSupport, timeWindowMs });
  patterns.forEach(pattern => {
    insights.push({
      type: "pattern",
      description: pattern.description,
      confidence: pattern.confidence,
      occurrences: pattern.count,
      firstSeen: pattern.firstSeen,
      lastSeen: pattern.lastSeen,
      severity: "info"
    });
  });

  // 2. Anomaly detection (statistical outlier detection)
  const anomalies = detectAnomalies(events, { threshold: anomalyThreshold });
  anomalies.forEach(anomaly => {
    insights.push({
      type: "anomaly",
      description: anomaly.description,
      metric: anomaly.metric,
      value: anomaly.value,
      expected: anomaly.expected,
      severity: anomaly.severity,
      timestamp: anomaly.timestamp
    });
  });

  // 3. Correlation detection (cross-event-type relationships)
  const correlations = detectCorrelations(events);
  correlations.forEach(corr => {
    insights.push({
      type: "correlation",
      description: corr.description,
      strength: corr.strength,
      events: corr.eventTypes,
      severity: "low"
    });
  });

  return insights;
}

/**
 * Detect sequential patterns in event stream
 * Simple implementation: count recurring subsequences of event types
 *
 * @param {Object[]} events - Event array (must be in time order)
 * @param {Object} params - { minSupport, timeWindowMs }
 * @returns {Array} Detected patterns
 */
function detectSequentialPatterns(events, params) {
  const { minSupport, timeWindowMs } = params;
  const patterns = new Map();

  // Generate 2-grams and 3-grams of event types
  for (let i = 0; i < events.length - 1; i++) {
    const e1 = events[i].type;
    const e2 = events[i + 1].type;
    const bigram = `${e1} → ${e2}`;
    patterns.set(bigram, (patterns.get(bigram) || 0) + 1);

    if (i < events.length - 2) {
      const e3 = events[i + 2].type;
      const trigram = `${e1} → ${e2} → ${e3}`;
      patterns.set(trigram, (patterns.get(trigram) || 0) + 1);
    }
  }

  // Filter by minSupport
  const frequent = [];
  for (const [pattern, count] of patterns) {
    if (count >= minSupport) {
      frequent.push({
        description: `Frequent sequence: ${pattern}`,
        pattern,
        count,
        confidence: count / events.length,
        firstSeen: events[0].timestamp,
        lastSeen: events[events.length - 1].timestamp
      });
    }
  }

  return frequent.sort((a, b) => b.count - a.count);
}

/**
 * Detect anomalies using statistical methods (z-score on event rates)
 *
 * @param {Object[]} events - Event array
 * @param {Object} params - { threshold (std deviations) }
 * @returns {Array} Anomaly flags
 */
function detectAnomalies(events, params) {
  const { threshold } = params;
  const anomalies = [];

  // Group events by type and count per time window (simplified: use overall)
  const typeCounts = new Map();
  for (const event of events) {
    typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
  }

  // Compute mean and std dev across types
  const counts = Array.from(typeCounts.values());
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  // Flag types that deviate significantly
  for (const [type, count] of typeCounts) {
    const z = Math.abs(count - mean) / stdDev;
    if (z > threshold) {
      anomalies.push({
        type,
        description: `Anomalous event frequency: ${type} (${count} events, z=${z.toFixed(2)})`,
        metric: "event_rate",
        value: count,
        expected: Math.round(mean),
        severity: count > mean ? "high" : "low",
        timestamp: new Date().toISOString()
      });
    }
  }

  return anomalies;
}

/**
 * Detect correlations between event types
 * Simple: co-occurrence within short time windows
 *
 * @param {Object[]} events - Event array
 * @returns {Array} Correlation findings
 */
function detectCorrelations(events) {
  const correlations = [];
  const windowSize = 10; // Look at 10-event window

  for (let i = 0; i < events.length - windowSize; i++) {
    const window = events.slice(i, i + windowSize);
    const typesInWindow = new Set(window.map(e => e.type));

    // Check for frequently co-occurring pairs
    const typePairs = [];
    const types = Array.from(typesInWindow);
    for (let a = 0; a < types.length; a++) {
      for (let b = a + 1; b < types.length; b++) {
        typePairs.push([types[a], types[b]].sort());
      }
    }

    // Count occurrences of each pair across all windows
    // (this is a simplified placeholder; full impl would aggregate)
  }

  // Return simple placeholder for now
  return correlations;
}

/**
 * Rate an insight's severity considering business impact
 *
 * @param {Object} insight - Detected insight
 * @returns {string} severity level (low, medium, high, critical)
 */
export function rateInsightSeverity(insight) {
  if (insight.type === "anomaly" && insight.severity === "high") {
    return "critical";
  }
  if (insight.type === "pattern" && insight.confidence > 0.8) {
    return "high";
  }
  return insight.severity || "low";
}

/**
 * Summarize insights for a given time period
 *
 * @param {Object[]} insights - Array of insights
 * @returns {Object} Summary statistics
 */
export function summarizeInsights(insights) {
  const byType = {};
  const bySeverity = {};

  insights.forEach(insight => {
    byType[insight.type] = (byType[insight.type] || 0) + 1;
    const severity = rateInsightSeverity(insight);
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  });

  return {
    total: insights.length,
    byType,
    bySeverity,
    criticalCount: bySeverity.critical || 0
  };
}
