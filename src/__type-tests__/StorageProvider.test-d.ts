import { expectType } from 'tsd';
import type { KnowledgeGraph, Entity } from '../KnowledgeGraphManager.js';
import type { Relation } from '../types/relation.js';
import type { StorageProvider } from '../storage/StorageProvider.js';

interface CustomEntity extends Entity {
  customFlag: boolean;
}

interface CustomRelation extends Relation {
  traceId?: string;
}

declare const defaultProvider: StorageProvider;
declare const customEntityProvider: StorageProvider<CustomEntity>;
declare const customRelationProvider: StorageProvider<CustomEntity, CustomRelation>;
declare const customEntities: CustomEntity[];
declare const customRelations: CustomRelation[];

expectType<Promise<Entity[]>>(defaultProvider.createEntities([] as Entity[]));
expectType<Promise<Entity | null>>(defaultProvider.getEntity('default'));

expectType<Promise<CustomEntity[]>>(customEntityProvider.createEntities(customEntities));
expectType<Promise<CustomEntity | null>>(customEntityProvider.getEntity('custom'));

expectType<Promise<CustomRelation[]>>(customRelationProvider.createRelations(customRelations));
expectType<Promise<KnowledgeGraph<CustomEntity, CustomRelation>>>(customRelationProvider.loadGraph());
expectType<Promise<KnowledgeGraph<CustomEntity, CustomRelation>>>(
  customRelationProvider.searchNodes('query')
);
