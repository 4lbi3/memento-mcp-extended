/**
 * Metadata for relations providing additional context and information
 */
export interface RelationMetadata {
  /**
   * Array of relation IDs that this relation was inferred from
   */
  inferredFrom?: string[];

  /**
   * Timestamp when the relation was last accessed/retrieved
   */
  lastAccessed?: number;

  /**
   * Timestamp when the relation was created
   */
  createdAt: number;

  /**
   * Timestamp when the relation was last updated
   */
  updatedAt: number;
}

/**
 * Represents a relationship between two entities in the knowledge graph
 */
export interface Relation<TMetadata extends RelationMetadata = RelationMetadata> {
  /**
   * The source entity name (where the relation starts)
   */
  from: string;

  /**
   * The target entity name (where the relation ends)
   */
  to: string;

  /**
   * The type of relationship between the entities
   */
  relationType: string;

  /**
   * Optional strength of the relationship (0.0-1.0)
   * Higher values indicate stronger relationships
   */
  strength?: number | null;

  /**
   * Optional confidence score (0.0-1.0)
   * Represents how confident the system is about this relationship
   * Particularly useful for inferred relations
   */
  confidence?: number | null;

  /**
   * Optional metadata providing additional context about the relation
   */
  metadata?: TMetadata;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Add static methods to the Relation interface for JavaScript tests
// This allows tests to access validation methods directly from the interface
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Relation {
  export function isRelation(obj: unknown): obj is Relation {
    return RelationValidator.isRelation(obj);
  }

  export function hasStrength(obj: unknown): obj is Relation {
    return RelationValidator.hasStrength(obj);
  }

  export function hasConfidence(obj: unknown): obj is Relation {
    return RelationValidator.hasConfidence(obj);
  }

  export function hasValidMetadata(obj: unknown): boolean {
    return RelationValidator.hasValidMetadata(obj);
  }
}

// Concrete class for JavaScript tests
export class RelationValidator {
  /**
   * Validates if an object conforms to the Relation interface
   */
  static isRelation(obj: unknown): obj is Relation {
    if (!isPlainObject(obj)) {
      return false;
    }

    const { from, to, relationType, strength, confidence, metadata } = obj as Partial<Relation>;

    return (
      typeof from === 'string' &&
      typeof to === 'string' &&
      typeof relationType === 'string' &&
      (strength === undefined || strength === null || typeof strength === 'number') &&
      (confidence === undefined || confidence === null || typeof confidence === 'number') &&
      (metadata === undefined || isPlainObject(metadata))
    );
  }

  /**
   * Checks if a relation has a strength value
   */
  static hasStrength(obj: unknown): obj is Relation {
    return (
      this.isRelation(obj) &&
      typeof obj.strength === 'number' &&
      obj.strength >= 0 &&
      obj.strength <= 1
    );
  }

  /**
   * Checks if a relation has a confidence value
   */
  static hasConfidence(obj: unknown): obj is Relation {
    return (
      this.isRelation(obj) &&
      typeof obj.confidence === 'number' &&
      obj.confidence >= 0 &&
      obj.confidence <= 1
    );
  }

  /**
   * Checks if a relation has valid metadata
   */
  static hasValidMetadata(obj: unknown): boolean {
    if (!this.isRelation(obj) || !obj.metadata) {
      return false;
    }

    const metadata = obj.metadata;

    if (!isPlainObject(metadata)) {
      return false;
    }

    // Required fields
    if (typeof metadata.createdAt !== 'number' || typeof metadata.updatedAt !== 'number') {
      return false;
    }

    // Optional fields
    if (metadata.lastAccessed !== undefined && typeof metadata.lastAccessed !== 'number') {
      return false;
    }

    if (metadata.inferredFrom !== undefined) {
      if (!Array.isArray(metadata.inferredFrom)) {
        return false;
      }

      // Verify all items in inferredFrom are strings
      for (const id of metadata.inferredFrom) {
        if (typeof id !== 'string') {
          return false;
        }
      }
    }

    return true;
  }
}
