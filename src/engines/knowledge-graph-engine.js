import { createStableId, readJsonFile, writeJsonFile } from "../lib/storage.js";

function resolveGraphFile(layout, scope) {
  return scope === "global" ? layout.globalKnowledgeGraphFile : layout.projectKnowledgeGraphFile;
}

function createNodeSnapshot(entry) {
  return {
    id: entry.id,
    type: entry.type,
    scope: entry.scope,
    topic: entry.topic ?? null,
    text: entry.text,
    status: entry.status,
    score: entry.score ?? 1,
    updatedAt: entry.updatedAt ?? entry.createdAt ?? null
  };
}

function upsertNodes(graph, entries) {
  const nodeMap = new Map((graph.nodes ?? []).map((node) => [node.id, node]));

  for (const entry of entries) {
    nodeMap.set(entry.id, {
      ...(nodeMap.get(entry.id) ?? {}),
      ...createNodeSnapshot(entry)
    });
  }

  graph.nodes = [...nodeMap.values()];
}

function inferRelation(sourceEntry, targetEntry) {
  if (sourceEntry.id === targetEntry.id || !sourceEntry.topic || sourceEntry.topic !== targetEntry.topic) {
    return null;
  }

  if (sourceEntry.type === "forbidden" || targetEntry.type === "forbidden") {
    return "contradicts";
  }

  if (sourceEntry.type === targetEntry.type) {
    return "extends";
  }

  if (sourceEntry.type === "decision" && ["rule", "solution"].includes(targetEntry.type)) {
    return "supports";
  }

  if (sourceEntry.type === "fact" && ["decision", "rule", "solution"].includes(targetEntry.type)) {
    return "supports";
  }

  return "relates_to";
}

function buildEdgeKey(edge) {
  return `${edge.sourceId}:${edge.relation}:${edge.targetId}`;
}

function upsertEdges(graph, edges) {
  const edgeMap = new Map((graph.edges ?? []).map((edge) => [buildEdgeKey(edge), edge]));

  for (const edge of edges) {
    edgeMap.set(buildEdgeKey(edge), {
      ...(edgeMap.get(buildEdgeKey(edge)) ?? { id: createStableId("graph-edge") }),
      ...edge
    });
  }

  graph.edges = [...edgeMap.values()];
}

function createRelationEdges(addedEntries, existingEntries) {
  const edges = [];

  for (const addedEntry of addedEntries) {
    const relatedEntries = existingEntries
      .filter((entry) => entry.status === "active" && entry.id !== addedEntry.id && entry.topic === addedEntry.topic)
      .slice(-8);

    for (const relatedEntry of relatedEntries) {
      const relation = inferRelation(addedEntry, relatedEntry);

      if (!relation) {
        continue;
      }

      edges.push({
        sourceId: addedEntry.id,
        targetId: relatedEntry.id,
        relation,
        weight: relation === "supports" ? 1 : 0.6,
        updatedAt: new Date().toISOString()
      });
    }
  }

  return edges;
}

function createInvalidationEdges(invalidatedEntries) {
  const edges = [];

  for (const invalidatedEntry of invalidatedEntries) {
    for (const actorId of invalidatedEntry.invalidatedBy ?? []) {
      edges.push({
        sourceId: actorId,
        targetId: invalidatedEntry.id,
        relation: "invalidates",
        weight: 1,
        updatedAt: new Date().toISOString()
      });
    }
  }

  return edges;
}

function createConflictEdges(conflicts) {
  return conflicts.flatMap((conflict) => [
    {
      sourceId: conflict.existingId,
      targetId: conflict.incomingId,
      relation: "conflicts_with",
      weight: 1,
      updatedAt: new Date().toISOString()
    },
    {
      sourceId: conflict.incomingId,
      targetId: conflict.existingId,
      relation: "conflicts_with",
      weight: 1,
      updatedAt: new Date().toISOString()
    }
  ]);
}

export async function loadKnowledgeGraph(layout, scope) {
  return readJsonFile(resolveGraphFile(layout, scope), { nodes: [], edges: [], updatedAt: null });
}

export function summarizeKnowledgeGraph(graph) {
  return {
    nodeCount: (graph.nodes ?? []).length,
    edgeCount: (graph.edges ?? []).length,
    relationCounts: (graph.edges ?? []).reduce((accumulator, edge) => {
      accumulator[edge.relation] = (accumulator[edge.relation] ?? 0) + 1;
      return accumulator;
    }, {})
  };
}

export async function updateKnowledgeGraph(layout, { existingEntries = [], addedEntries = [], invalidatedEntries = [], conflicts = [] } = {}) {
  const globalGraph = await loadKnowledgeGraph(layout, "global");
  const projectGraph = await loadKnowledgeGraph(layout, "project");
  const scopeGraphs = {
    global: globalGraph,
    project: projectGraph
  };
  const allAffectedEntries = [...addedEntries, ...invalidatedEntries];

  for (const graph of Object.values(scopeGraphs)) {
    graph.updatedAt = new Date().toISOString();
  }

  for (const scope of ["global", "project"]) {
    const scopedEntries = allAffectedEntries.filter((entry) => entry.scope === scope);
    upsertNodes(scopeGraphs[scope], scopedEntries);
    upsertEdges(scopeGraphs[scope], createRelationEdges(scopedEntries, existingEntries));
    upsertEdges(scopeGraphs[scope], createInvalidationEdges(invalidatedEntries.filter((entry) => entry.scope === scope)));
    upsertEdges(scopeGraphs[scope], createConflictEdges(conflicts.filter((conflict) => conflict.scope === scope)));
  }

  await writeJsonFile(layout.globalKnowledgeGraphFile, globalGraph);
  await writeJsonFile(layout.projectKnowledgeGraphFile, projectGraph);

  return {
    global: summarizeKnowledgeGraph(globalGraph),
    project: summarizeKnowledgeGraph(projectGraph)
  };
}

export async function getRelatedKnowledge(layout, entryId, scope) {
  const graph = await loadKnowledgeGraph(layout, scope);
  const edgeTargets = (graph.edges ?? []).filter((edge) => edge.sourceId === entryId || edge.targetId === entryId);
  const nodeMap = new Map((graph.nodes ?? []).map((node) => [node.id, node]));

  return edgeTargets.map((edge) => ({
    ...edge,
    source: nodeMap.get(edge.sourceId) ?? null,
    target: nodeMap.get(edge.targetId) ?? null
  }));
}
