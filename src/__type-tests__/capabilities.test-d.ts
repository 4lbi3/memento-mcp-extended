import { expectType } from 'tsd';
import type { KnowledgeGraph, Entity } from '../KnowledgeGraphManager.js';
import type { Relation } from '../types/relation.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import {
  hasConnectionManager,
  hasEmbeddingCapability,
  hasPurgeCapability,
  hasSemanticSearchCapabilities,
  hasTemporalCapability,
  hasVectorSearchCapability,
  type ConnectionCapableProvider,
  type EmbeddingCapableProvider,
  type PurgeCapableProvider,
  type TemporalCapableProvider,
  type VectorSearchCapableProvider,
} from '../storage/capabilities.js';

interface CustomEntity extends Entity {
  customFlag: boolean;
}

interface CustomRelation extends Relation {
  traceId?: string;
}

declare const embeddingCandidate: StorageProvider<CustomEntity>;
declare const vectorCandidate: StorageProvider<CustomEntity>;
declare const temporalCandidate: StorageProvider<CustomEntity, CustomRelation>;
declare const connectionCandidate: StorageProvider;
declare const purgeCandidate: StorageProvider;
declare const semanticCandidate: StorageProvider<CustomEntity>;

if (hasEmbeddingCapability(embeddingCandidate)) {
  expectType<EmbeddingCapableProvider<CustomEntity>>(embeddingCandidate);
  expectType<Promise<CustomEntity[]>>(embeddingCandidate.getEntitiesWithoutEmbeddings());
  expectType<Promise<number>>(embeddingCandidate.countEntitiesWithEmbeddings());
}

if (hasVectorSearchCapability(vectorCandidate)) {
  expectType<VectorSearchCapableProvider<CustomEntity>>(vectorCandidate);
  expectType<Promise<Array<CustomEntity & { score: number }>>>(
    vectorCandidate.findSimilarEntities([0], 5)
  );
  expectType<Promise<KnowledgeGraph<CustomEntity>>>(vectorCandidate.semanticSearch('test'));
}

if (hasTemporalCapability(temporalCandidate)) {
  expectType<TemporalCapableProvider<CustomEntity, CustomRelation>>(temporalCandidate);
  expectType<Promise<CustomEntity[]>>(temporalCandidate.getEntityHistory('entity'));
  expectType<Promise<CustomRelation[]>>(temporalCandidate.getRelationHistory('from', 'to', 'type'));
  expectType<Promise<KnowledgeGraph<CustomEntity, CustomRelation>>>(
    temporalCandidate.getGraphAtTime(Date.now())
  );
  expectType<Promise<KnowledgeGraph<CustomEntity, CustomRelation>>>(
    temporalCandidate.getDecayedGraph()
  );
}

if (hasSemanticSearchCapabilities(semanticCandidate)) {
  expectType<
    EmbeddingCapableProvider<CustomEntity> & VectorSearchCapableProvider<CustomEntity>
  >(semanticCandidate);
}

if (hasConnectionManager(connectionCandidate)) {
  expectType<ConnectionCapableProvider>(connectionCandidate);
}

if (hasPurgeCapability(purgeCandidate)) {
  expectType<PurgeCapableProvider>(purgeCandidate);
}
