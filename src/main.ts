#!/usr/bin/env node

/**
 * Dynamically seeds a knowledge graph by discovering programming concepts and their relationships
 * 
 * Uses LLM to recursively explore and map programming knowledge units, building an organic
 * knowledge graph structure. Makes database-aware requests to avoid duplicates and maintain
 * coherence across the graph.
 * 
 * Key features:
 * - Recursive discovery of knowledge units and relationships
 * - Database-aware LLM prompting to avoid duplicates
 * - Robust JSON parsing with fallback strategies
 * - Configurable exploration depth and breadth
 * - Progressive graph building across multiple runs
 * - Retry logic for failed LLM calls
 * - Validation of generated content
 * 
 * @module main
 */

import { Neo4jConnection } from './database/neo4j-connector.js';
import { KnowledgeUnitData } from './types/index.js';
import { LlmService } from './services/llm-service.js';
import { getNeo4jConfig, getLlmConfig, parseCliArgs } from './utils/config.js';
import { logger } from './utils/logger.js';
import { setTimeout } from 'timers/promises';

// Import operations
import { 
  initProcessedEntities, 
  reachedEntityLimit,
  trackUnit,
  trackRelationship,
  isUnitProcessed
} from './graph-operations/entity-tracker.js';
import { discoverSeedDomains } from './graph-operations/seed-domains.js';
import { discoverChildUnits } from './graph-operations/child-units.js';
import { discoverRelationships } from './graph-operations/relationships.js';
import { validateKnowledgeGraph } from './graph-operations/validation.js';

/**
 * Process a knowledge unit, create it, and explore its relationships
 */
async function processKnowledgeUnit(
  db: Neo4jConnection,
  llm: LlmService,
  unit: KnowledgeUnitData,
  depth: number,
  processed: any,
  config: any
): Promise<void> {
  // Check if we've already processed this unit
  if (isUnitProcessed(processed, unit.name)) {
    logger.debug(`Knowledge unit already processed: ${unit.name}`);
    return;
  }

  logger.info(`Processing knowledge unit: ${unit.name} (depth ${depth})`);

  try {
    // Create the knowledge unit
    await db.createKnowledgeUnit(unit);
    trackUnit(processed, unit.name);
    logger.info(`Created knowledge unit: ${unit.name}`);

    // If we've reached max depth, stop here
    if (depth >= config.maxExplorationDepth) {
      logger.debug(`Reached maximum exploration depth (${config.maxExplorationDepth}) for unit: ${unit.name}`);
      return;
    }

    // Discover relationships for this unit
    const relationships = await discoverRelationships(llm, unit, db, processed, config);

    // Process each relationship
    if (relationships && relationships.length > 0) {
      for (const rel of relationships) {
        if (reachedEntityLimit(processed, config)) break;

        // Skip self-references
        if (rel.sourceName === rel.targetName) continue;

        try {
          // Create the relationship
          await db.createRelationship(rel);
          trackRelationship(processed, rel.sourceName as string, rel.targetName as string, rel.type);
          logger.debug(`Created relationship: ${rel.sourceName} -[${rel.type}]-> ${rel.targetName}`);
        } catch (error) {
          logger.error('Error creating relationship', {
            error,
            source: rel.sourceName,
            target: rel.targetName,
            type: rel.type
          });
        }

        // Add delay between creating relationships
        await setTimeout(config.llmCallDelay / 2);
      }
    }

    // If this is not the bottom level, discover and explore child units
    if (depth < config.maxExplorationDepth - 1) {
      const childUnits = await discoverChildUnits(llm, unit, config.childrenPerUnit, db, config);

      // Process each child unit recursively
      if (childUnits && childUnits.length > 0) {
        for (const childUnit of childUnits) {
          if (reachedEntityLimit(processed, config)) break;

          await processKnowledgeUnit(db, llm, childUnit, depth + 1, processed, config);

          // Add delay between processing each child unit
          await setTimeout(config.llmCallDelay);
        }
      } else {
        logger.warn(`No valid child units generated for unit: ${unit.name}`);
      }
    }
  } catch (error) {
    logger.error('Error processing knowledge unit', { error, unitName: unit.name });
  }
}

/**
 * Main function to dynamically seed the knowledge graph
 */
async function seedKnowledgeGraphDynamically(
  db: Neo4jConnection,
  llm: LlmService,
  config: any
): Promise<void> {
  logger.info('Starting dynamic knowledge graph seeding process');

  // Get database stats before seeding
  const startStats = await db.getKnowledgeGraphStats();
  logger.info('Initial database stats:', startStats);

  // Clear existing data if configured
  if (config.clearExistingData) {
    logger.warn('Clearing existing database data');
    await db.clearDatabase();
  }

  // Initialize tracking of processed entities
  const processed = initProcessedEntities();

  // Start with seed domains (high-level programming domains)
  const seedDomains = await discoverSeedDomains(llm, db, config);
  logger.info(`Discovered ${seedDomains.length} seed domains`);

  // Process each seed domain recursively
  for (const domain of seedDomains) {
    if (reachedEntityLimit(processed, config)) {
      logger.warn(`Reached entity limit (${config.maxTotalEntities}). Stopping exploration.`);
      break;
    }

    await processKnowledgeUnit(db, llm, domain, 0, processed, config);

    // Add delay between processing each seed domain
    await setTimeout(config.llmCallDelay);
  }

  // Perform validation if enabled
  if (config.enableValidation) {
    await validateKnowledgeGraph(db, llm, processed, config);
  }

  // Get database stats after seeding
  const endStats = await db.getKnowledgeGraphStats();
  logger.info('Final database stats:', endStats);

  // Log summary of changes
  logger.info('Knowledge graph seeding completed', {
    unitsAdded: endStats.unitCount - startStats.unitCount,
    relationshipsAdded: (
      (endStats.containsCount - startStats.containsCount) +
      (endStats.requiresCount - startStats.requiresCount) +
      (endStats.relatedToCount - startStats.relatedToCount)
    )
  });
}

/**
 * Main execution function
 */
async function main() {
  logger.info('Starting dynamic knowledge graph seeding script');

  try {
    // Parse command line arguments for configuration
    const args = process.argv.slice(2);
    const config = parseCliArgs(args);

    // Initialize database connection
    const db = new Neo4jConnection(getNeo4jConfig());
    await db.initialize();

    // Close the database connection gracefully on SIGINT
    process.on('SIGINT', async () => {
      logger.info('Closing database connection...');
      await db.close();
      process.exit(0);
    });

    // Initialize LLM service
    const llm = new LlmService(getLlmConfig());

    // Seed the knowledge graph
    await seedKnowledgeGraphDynamically(db, llm, config);

    // Close the database connection
    await db.close();

    logger.info('Knowledge graph seeding completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error in knowledge graph seeding script', { error });
    process.exit(1);
  }
}

// Execute the script if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error in main function', { error });
    process.exit(1);
  });
}

// Export for testing/importing
export {
  seedKnowledgeGraphDynamically,
  processKnowledgeUnit
};