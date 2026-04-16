/**
 * graphrag-engine.js — Phase IV: GraphRAG Hybrid Search
 *
 * Combines vector similarity (semantic) with graph traversal (MAGMA dimensions)
 * for intent-aware knowledge retrieval.
 *
 * Algorithm (HybridRAG):
 * 1. Vector Search: Find top-K entries by embedding similarity to query
 * 2. Graph Expansion: For each candidate, traverse edges of relevant dimensions
 * 3. Score Fusion: Combine semantic score with graph centrality + escalation index
 * 4. Rank & Return: Final list sorted by fused score
 *
 * @module graphrag-engine
 */

import { GraphDimension } from "./retrieval-planner.js";
import { loadKnowledgeGraph, getRelatedKnowledge } from "./knowledge-graph-engine.js";
import { generateEmbedding, cosineSimilarity } from "./embedding-engine.js";

const DEFAULT_TOP_K_SEMANTIC = 20;
const DEFAULT_TOP_K_FINAL = 30;
const DEFAULT_GRAPH_HOPS = 1;

/**
 * Perform GraphRAG search: semantic + graph traversal
 *
 * @param {Object} layout - PCPM layout
 * @param {string} query - Search query
 * @param {Object} options - {
 *   intent: 'debugging'|'creation'|'refactoring'|'deployment'|'security'|'general',
 *   topKSemantic: number,
 *   topKFinal: number,
 *   maxHops: number,
 *   dimensions: string[] (override automatic dimension selection)
 * }
 * @returns {Promise<Array<{id: string, score: number, sources: string[]}>>} Ranked results
 */
export async function searchGraphRAG(layout, query, options = {}) {
  const {
    intent = "general",
    topKSemantic = DEFAULT_TOP_K_SEMANTIC,
    topKFinal = DEFAULT_TOP_K_FINAL,
    maxHops = DEFAULT_GRAPH_HOPS,
    dimensions // optional override
  } = options;

  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // 2. Load knowledge graph (both global and project)
  const globalGraph = await loadKnowledgeGraph(layout, "global");
  const projectGraph = await loadKnowledgeGraph(layout, "project");

  // Combine nodes and edges from both graphs
  const allNodes = [...(globalGraph.nodes ?? []), ...(projectGraph.nodes ?? [])];
  const allEdges = [...(globalGraph.edges ?? []), ...(projectGraph.edges ?? [])];

  // Filter nodes that have embeddings and are active
  const embeddingCandidates = allNodes.filter((node) =>
    node.embedding && node.status === "active"
  );

  if (embeddingCandidates.length === 0) {
    console.warn("[GraphRAG] No nodes with embeddings found");
    return [];
  }

  // 3. Semantic similarity search (top-K)
  const semanticScores = embeddingCandidates.map((node) => ({
    id: node.id,
    score: cosineSimilarity(queryEmbedding, node.embedding),
    node
  })).filter(item => isFinite(item.score));

  const topSemantic = semanticScores
    .sort((a, b) => b.score - a.score)
    .slice(0, topKSemantic)
    .map(item => item.id);
  const topSemanticSet = new Set(topSemantic);

  // 4. Graph expansion: traverse edges from top semantic candidates
  const relevantDimensions = dimensions || selectDimensionsForIntent(intent);
  const expandedIds = new Set(topSemantic); // Start with semantic results

  // Build adjacency list for fast traversal
  const adjacency = new Map();
  for (const edge of allEdges) {
    if (!relevantDimensions.includes(edge.dimension)) {
      continue; // Skip edges of irrelevant dimensions
    }
    if (!adjacency.has(edge.sourceId)) {
      adjacency.set(edge.sourceId, []);
    }
    adjacency.get(edge.sourceId).push({
      targetId: edge.targetId,
      relation: edge.relation,
      dimension: edge.dimension,
      weight: edge.weight ?? 1
    });
  }

  // BFS expansion up to maxHops
  const frontier = topSemantic.map(id => ({ id, hop: 0 }));
  const visited = new Set(topSemantic);

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current.hop >= maxHops) continue;

    const neighbors = adjacency.get(current.id) ?? [];
    for (const edge of neighbors) {
      if (!visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        expandedIds.add(edge.targetId);
        frontier.push({ id: edge.targetId, hop: current.hop + 1 });
      }
    }
  }

  // 5. Score fusion: combine semantic score with graph centrality + entry score
  const results = allNodes
    .filter(node => expandedIds.has(node.id))
    .map(node => {
      const semanticScore = topSemanticSet.has(node.id)
        ? semanticScores.find(s => s.id === node.id)?.score ?? 0
        : 0; // Non-semantic nodes get 0 base; they'll rely on graph boost

      // Graph centrality: number of incoming/outgoing edges (simple degree)
      const degree = (allEdges.filter(e => e.sourceId === node.id || e.targetId === node.id).length);
      const degreeScore = Math.min(degree / 10, 1); // normalize to [0,1]

      // Entry's own quality score (escalationIndex or score)
      const qualityScore = node.escalationIndex ?? node.score ?? 1;

      // Fusion: 0.5*semantic + 0.3*degree + 0.2*quality
      const fusedScore =
        0.5 * semanticScore +
        0.3 * degreeScore +
        0.2 * qualityScore;

      return {
        id: node.id,
        score: Number(fusedScore.toFixed(4)),
        sources: [
          semanticScore > 0 ? 'semantic' : null,
          degreeScore > 0.1 ? 'graph' : null,
          qualityScore > 0.5 ? 'quality' : null
        ].filter(Boolean)
      };
    })
    .filter(item => item.score > 0) // Only include items with some relevance
    .sort((a, b) => b.score - a.score)
    .slice(0, topKFinal);

  return results;
}

/**
 * Select which MAGMA dimensions to traverse based on intent.
 *
 * @param {string} intent - Task intent
 * @returns {string[]} Array of GraphDimension values
 */
function selectDimensionsForIntent(intent) {
  switch (intent) {
    case "debugging":
      // Use causal (invalidates, contradicts) + entity (same topic)
      return [GraphDimension.CAUSAL, GraphDimension.ENTITY];
    case "creation":
      // Semantic + entity for meaning and topic grouping
      return [GraphDimension.SEMANTIC, GraphDimension.ENTITY];
    case "refactoring":
      // Causal (to avoid past mistakes) + entity
      return [GraphDimension.CAUSAL, GraphDimension.ENTITY];
    case "deployment":
      // Temporal would be ideal but not fully implemented yet; fall back to semantic + entity
      return [GraphDimension.SEMANTIC, GraphDimension.ENTITY];
    case "security":
      // Causal (vulnerabilities, invalidations) critical
      return [GraphDimension.CAUSAL, GraphDimension.ENTITY];
    case "general":
    default:
      return [GraphDimension.SEMANTIC, GraphDimension.ENTITY];
  }
}

/**
 * Get full node details by IDs (batch lookup)
 *
 * @param {Object} layout - PCPM layout
 * @param {string[]} ids - Node IDs
 * @returns {Promise<Array>} Full node objects
 */
export async function getNodesByIds(layout, ids) {
  const globalGraph = await loadKnowledgeGraph(layout, "global");
  const projectGraph = await loadKnowledgeGraph(layout, "project");
  const allNodes = [...(globalGraph.nodes ?? []), ...(projectGraph.nodes ?? [])];
  const nodeMap = new Map(allNodes.map(node => [node.id, node]));
  return ids.map(id => nodeMap.get(id)).filter(Boolean);
}

/**
 * Build a subgraph for visualization or analysis (for debugging)
 *
 * @param {Object} layout - PCPM layout
 * @param {string[]} seedIds - Starting node IDs
 * @param {number} hops - Number of hops to expand
 * @returns {Object} { nodes: [], edges: [] }
 */
export function buildSubgraph(layout, seedIds, hops = 1) {
  // This is a synchronous version that works on already-loaded graphs
  // For simplicity, we'd load graphs async. This is a placeholder.
  return { nodes: [], edges: [] };
}
