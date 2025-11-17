import { describe, it, expect } from 'vitest';
import {
  hasEmbeddingCapability,
  hasConnectionManager,
  hasPurgeCapability,
  hasSemanticSearchCapabilities,
  hasTemporalCapability,
  hasVectorSearchCapability,
} from '../capabilities.js';
import type { StorageProvider } from '../StorageProvider.js';

const baseProvider = {
  loadGraph: () => Promise.resolve({ entities: [], relations: [] }),
  saveGraph: () => Promise.resolve(undefined),
  searchNodes: () => Promise.resolve({ entities: [], relations: [] }),
  openNodes: () => Promise.resolve({ entities: [], relations: [] }),
  createEntities: () => Promise.resolve([]),
  createRelations: () => Promise.resolve([]),
  addObservations: () => Promise.resolve([]),
  deleteEntities: () => Promise.resolve(),
  deleteObservations: () => Promise.resolve(),
  deleteRelations: () => Promise.resolve(),
  getEntity: () => Promise.resolve(null),
};

describe('Capability guards', () => {
  it('detects embedding capability when available', () => {
    const provider = {
      ...baseProvider,
      getEntityEmbedding: () => Promise.resolve(null),
    } as unknown as StorageProvider;

    expect(hasEmbeddingCapability(provider)).toBe(true);
  });

  it('rejects missing embedding capability', () => {
    const provider = { ...baseProvider } as StorageProvider;
    expect(hasEmbeddingCapability(provider)).toBe(false);
  });

  it('detects vector search capability when both methods exist', () => {
    const provider = {
      ...baseProvider,
      findSimilarEntities: () => Promise.resolve([]),
      semanticSearch: () => Promise.resolve({ entities: [], relations: [] }),
    } as unknown as StorageProvider;

    expect(hasVectorSearchCapability(provider)).toBe(true);
  });

  it('rejects vector search when method missing', () => {
    const provider = { ...baseProvider, semanticSearch: () => Promise.resolve({ entities: [], relations: [] }) } as StorageProvider;
    expect(hasVectorSearchCapability(provider)).toBe(false);
  });

  it('detects temporal capability when history is exposed', () => {
    const provider = {
      ...baseProvider,
      getEntityHistory: () => Promise.resolve([]),
      getGraphAtTime: () => Promise.resolve({ entities: [], relations: [] }),
    } as unknown as StorageProvider;

    expect(hasTemporalCapability(provider)).toBe(true);
  });

  it('detects purge capability when both purge helpers exist', () => {
    const provider = {
      ...baseProvider,
      purgeArchivedEntities: () => Promise.resolve(0),
      purgeArchivedRelations: () => Promise.resolve(0),
    } as unknown as StorageProvider;

    expect(hasPurgeCapability(provider)).toBe(true);
  });

  it('detects connection manager capability', () => {
    const provider = {
      ...baseProvider,
      getConnectionManager: () => ({ close: () => Promise.resolve() } as never),
    } as unknown as StorageProvider;

    expect(hasConnectionManager(provider)).toBe(true);
  });

  it('detects semantic search capability as composite guard', () => {
    const provider = {
      ...baseProvider,
      getEntityEmbedding: () => Promise.resolve(null),
      findSimilarEntities: () => Promise.resolve([]),
      semanticSearch: () => Promise.resolve({ entities: [], relations: [] }),
    } as unknown as StorageProvider;

    expect(hasSemanticSearchCapabilities(provider)).toBe(true);
  });
});
