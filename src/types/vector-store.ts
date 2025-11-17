export interface VectorSearchResult {
  id: string | number;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  initialize(): Promise<void>;

  addVector(
    id: string | number,
    vector: number[],
    metadata?: Record<string, unknown>
  ): Promise<void>;

  removeVector(id: string | number): Promise<void>;

  search(
    queryVector: number[],
    options?: {
      limit?: number;
      filter?: Record<string, unknown>;
      hybridSearch?: boolean;
      minSimilarity?: number;
    }
  ): Promise<VectorSearchResult[]>;

  diagnosticGetEntityEmbeddings?: () => Promise<Record<string, unknown>>;
}
