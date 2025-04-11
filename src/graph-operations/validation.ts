/**
 * Validate the knowledge graph for consistency
 */

import { ProcessedEntities, SeedingConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getValidationPrompt } from '../services/prompt-templates.js';
import { LlmService } from '../services/llm-service.js';
import { getSampleUnits } from '../utils/graph-queries.js';

/**
 * Validate the knowledge graph for consistency using LLM
 */
export async function validateKnowledgeGraph(
  db: any,
  llm: LlmService,
  processed: ProcessedEntities,
  config: SeedingConfig
): Promise<void> {
  logger.info('Validating knowledge graph for consistency');

  // Get database stats
  const stats = await db.getKnowledgeGraphStats();

  // Sample units for validation
  let units = await getSampleUnits(db, 20);
  
  // If database query fails, fallback to in-memory units
  if (units.length === 0) {
    units = Array.from(processed.units)
      .sort(() => 0.5 - Math.random())
      .slice(0, 20);
    
    logger.warn('No units returned from database for validation, using in-memory units');
  }

  // Generate validation prompt
  const promptConfig = getValidationPrompt(stats, units);

  try {
    const validation = await llm.makeLlmRequest<any>(promptConfig, config);

    if (validation) {
      logger.info('Knowledge graph validation:', validation);

      // TODO: Implement automatic fixes based on validation
    } else {
      logger.warn('Could not extract structured validation data from LLM response');
    }
  } catch (error) {
    logger.error('Error validating knowledge graph with LLM', { error });
  }
}
