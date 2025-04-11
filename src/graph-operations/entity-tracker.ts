/**
 * Entity tracking functionality for preventing duplicates during seeding
 */

import { ProcessedEntities, SeedingConfig } from '../types/index.js';

/**
 * Initialize tracking for processed entities
 */
export function initProcessedEntities(): ProcessedEntities {
  return {
    units: new Set<string>(),
    relationships: new Set<string>(),
    count: {
      units: 0,
      relationships: 0
    }
  };
}

/**
 * Check if we've reached the entity limit
 */
export function reachedEntityLimit(processed: ProcessedEntities, config: SeedingConfig): boolean {
  if (config.maxTotalEntities === 0) return false;
  return processed.count.units >= config.maxTotalEntities;
}

/**
 * Add a unit to the processed entities
 */
export function trackUnit(processed: ProcessedEntities, unitName: string): void {
  processed.units.add(unitName);
  processed.count.units++;
}

/**
 * Add a relationship to the processed entities
 */
export function trackRelationship(
  processed: ProcessedEntities,
  sourceName: string,
  targetName: string,
  type: string
): void {
  const relationshipKey = `${sourceName}|${targetName}|${type}`;
  processed.relationships.add(relationshipKey);
  processed.count.relationships++;
}

/**
 * Check if a unit has been processed
 */
export function isUnitProcessed(processed: ProcessedEntities, unitName: string): boolean {
  return processed.units.has(unitName);
}

/**
 * Check if a relationship has been processed
 */
export function isRelationshipProcessed(
  processed: ProcessedEntities,
  sourceName: string,
  targetName: string,
  type: string
): boolean {
  const relationshipKey = `${sourceName}|${targetName}|${type}`;
  return processed.relationships.has(relationshipKey);
}
