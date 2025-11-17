/**
 * Interface for entities with temporal metadata
 */
import type { Entity } from '../KnowledgeGraphManager.js';

/**
 * Represents an entity with temporal awareness capabilities
 * Extends the base Entity interface with time-based properties
 */
export interface TemporalEntity extends Entity {
  /**
   * Unique identifier for the entity
   */
  id?: string;

  /**
   * Timestamp when the entity was created (milliseconds since epoch)
   */
  createdAt: number;

  /**
   * Timestamp when the entity was last updated (milliseconds since epoch)
   */
  updatedAt: number;

  /**
   * Optional start time for the validity period (milliseconds since epoch)
   */
  validFrom?: number;

  /**
   * Optional end time for the validity period (milliseconds since epoch)
   */
  validTo?: number;

  /**
   * Version number, incremented with each update
   */
  version: number;

  /**
   * Optional identifier of the system or user that made the change
   */
  changedBy?: string;
}

// Add static methods to the TemporalEntity interface for JavaScript tests
// This allows tests to access validation methods directly from the interface
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TemporalEntity {
  export function isTemporalEntity(obj: unknown): obj is TemporalEntity {
    return TemporalEntityValidator.isTemporalEntity(obj);
  }

  export function hasValidTimeRange(obj: unknown): boolean {
    return TemporalEntityValidator.hasValidTimeRange(obj);
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * TemporalEntityValidator class with validation methods
 */
export class TemporalEntityValidator {
  /**
   * Validates if an object conforms to the TemporalEntity interface
   */
  static isTemporalEntity(obj: unknown): obj is TemporalEntity {
    // First ensure it's a valid Entity
    if (!isPlainObject(obj)) {
      return false;
    }

    const { name, entityType, observations } = obj as Partial<TemporalEntity>;

    if (
      typeof name !== 'string' ||
      typeof entityType !== 'string' ||
      !Array.isArray(observations)
    ) {
      return false;
    }

    // Then check temporal properties
    const { createdAt, updatedAt, version } = obj as Partial<TemporalEntity>;

    if (
      typeof createdAt !== 'number' ||
      typeof updatedAt !== 'number' ||
      typeof version !== 'number'
    ) {
      return false;
    }

    // Optional properties type checking
    const { validFrom, validTo, changedBy } = obj as Partial<TemporalEntity>;

    if (validFrom !== undefined && typeof validFrom !== 'number') {
      return false;
    }

    if (validTo !== undefined && typeof validTo !== 'number') {
      return false;
    }

    if (changedBy !== undefined && typeof changedBy !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Checks if an entity has a valid temporal range
   */
  static hasValidTimeRange(obj: unknown): boolean {
    if (!this.isTemporalEntity(obj)) {
      return false;
    }

    // If both are defined, validFrom must be before validTo
    if (obj.validFrom !== undefined && obj.validTo !== undefined) {
      return obj.validFrom <= obj.validTo;
    }

    return true;
  }
}
