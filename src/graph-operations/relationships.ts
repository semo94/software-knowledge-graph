/**
 * Discover relationships between knowledge units
 */

import { ProcessedEntities, SeedingConfig, KnowledgeUnitData, RelationshipData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getRelationshipsPrompt } from '../services/prompt-templates.js';
import { LlmService } from '../services/llm-service.js';
import { getExistingRelationships, getSampleUnits } from '../utils/graph-queries.js';
import { isRelationshipProcessed } from './entity-tracker.js';

/**
 * Discover relationships for a knowledge unit using LLM
 */
export async function discoverRelationships(
  llm: LlmService,
  unit: KnowledgeUnitData,
  db: any,
  processed: ProcessedEntities,
  config: SeedingConfig
): Promise<RelationshipData[]> {
  logger.info(`Discovering relationships for unit: ${unit.name}`);

  // Query existing relationships for this unit
  const existingRelationships = await getExistingRelationships(db, unit.name);

  // Get a list of known units to suggest realistic relationships
  let knownUnits = Array.from(processed.units)
    .filter(name => name !== unit.name) // Exclude self
    .sort(() => 0.5 - Math.random()) // Shuffle
    .slice(0, 15); // Take a random sample of known units

  // If we have few in-memory units, fetch some from the database
  if (knownUnits.length < 10) {
    const dbUnits = await getSampleUnits(db, 15, unit.name);
    
    // Combine with known units, removing duplicates
    knownUnits = Array.from(new Set([...knownUnits, ...dbUnits])).slice(0, 15);
  }

  // Generate prompts for relationships
  const promptConfig = getRelationshipsPrompt(
    unit, 
    config.relationshipsPerUnit, 
    existingRelationships,
    knownUnits
  );

  try {
    const relationships = await llm.makeLlmRequest<any[]>(promptConfig, config);

    if (relationships && Array.isArray(relationships)) {
      // Filter to ensure we don't exceed the relationship limit and avoid duplicates
      const validatedRelationships = relationships
        .filter(rel => {
          // Basic validation to filter out incomplete relationships
          return (
            rel &&
            typeof rel === 'object' &&
            typeof rel.sourceName === 'string' &&
            rel.sourceName.trim() !== '' &&
            typeof rel.targetName === 'string' &&
            rel.targetName.trim() !== '' &&
            typeof rel.type === 'string' &&
            ['contains', 'requires', 'related_to'].includes(rel.type)
          );
        })
        .filter(rel => {
          // Skip self-references
          if (rel.sourceName === rel.targetName) return false;
          
          // Check for duplicates with existing relationships
          return !isRelationshipProcessed(processed, rel.sourceName, rel.targetName, rel.type);
        })
        .map(rel => ({
          sourceName: rel.sourceName,
          targetName: rel.targetName,
          type: rel.type,
          strength: typeof rel.strength === 'number' ? rel.strength : 0.5,
          explanation: rel.explanation || `${rel.sourceName} ${rel.type.replace('_', ' ')} ${rel.targetName}`
        }));

      if (validatedRelationships.length === 0) {
        logger.warn(`No valid relationships found in LLM response for unit: ${unit.name}`);
      }

      return validatedRelationships.slice(0, config.relationshipsPerUnit);
    } else {
      logger.error('Failed to extract JSON from LLM response for relationships', { unitName: unit.name });
      return [];
    }
  } catch (error) {
    logger.error('Error generating relationships with LLM', { error, unitName: unit.name });
    return [];
  }
}
