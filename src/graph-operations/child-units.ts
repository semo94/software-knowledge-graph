/**
 * Discover child units for knowledge units
 */

import { SeedingConfig, KnowledgeUnitData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getChildUnitsPrompt } from '../services/prompt-templates.js';
import { LlmService } from '../services/llm-service.js'; 
import { getExistingChildUnits } from '../utils/graph-queries.js';

/**
 * Discover child units for a given parent unit using LLM
 */
export async function discoverChildUnits(
  llm: LlmService,
  parentUnit: KnowledgeUnitData,
  count: number,
  db: any,
  config: SeedingConfig
): Promise<KnowledgeUnitData[]> {
  logger.info(`Discovering ${count} child units for: ${parentUnit.name}`);

  // Query existing child units for this parent
  const existingChildren = await getExistingChildUnits(db, parentUnit.name);

  // Generate prompts for child units
  const promptConfig = getChildUnitsPrompt(parentUnit, count, existingChildren);

  try {
    const childUnits = await llm.makeLlmRequest<any[]>(promptConfig, config);

    if (childUnits && Array.isArray(childUnits)) {
      // Validate and format child units
      const validatedUnits = childUnits
        .filter(unit => {
          // Basic validation to filter out incomplete units
          return (
            unit &&
            typeof unit === 'object' &&
            typeof unit.name === 'string' &&
            unit.name.trim() !== '' &&
            typeof unit.description === 'string' &&
            unit.description.trim() !== ''
          );
        })
        .map(unit => ({
          name: unit.name,
          type: unit.type || getDefaultChildType(parentUnit.type),
          description: unit.description || `A ${unit.type || getDefaultChildType(parentUnit.type)} within ${parentUnit.name}`,
          complexity: unit.complexity || parentUnit.complexity
        }));

      if (validatedUnits.length === 0) {
        logger.warn(`No valid child units found in LLM response for: ${parentUnit.name}`);
      }

      return validatedUnits;
    } else {
      logger.error('Failed to extract JSON from LLM response for child units', { parentName: parentUnit.name });
      return [];
    }
  } catch (error) {
    logger.error('Error generating child units with LLM', { error, parentName: parentUnit.name });
    return [];
  }
}

/**
 * Helper function to determine the default child type based on parent type
 */
function getDefaultChildType(parentType: string): string {
  if (parentType === "domain") return "subject";
  if (parentType === "subject") return "topic";
  if (parentType === "topic") return "concept";
  return "concept";
}
