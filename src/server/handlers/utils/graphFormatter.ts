export function formatKnowledgeGraphForDisplay(graph: unknown): string {
  return JSON.stringify(graph, (_key, value) => (_key === 'embedding' ? undefined : value), 2);
}
