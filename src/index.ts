#!/usr/bin/env node

/**
 * Software Knowledge Graph - Main Entry Point
 * 
 * This file serves as the main entry point for the application when running
 * directly through the 'npm start' command.
 * 
 * For seeding the knowledge graph, use the following commands:
 * - npm run seed           # Normal seeding
 * - npm run seed:clear     # Clear existing data and then seed
 */

import { Neo4jConnection } from './database/neo4j-connector.js';
import { getNeo4jConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { logConfigValues } from './utils/config.js';

async function main() {
  logger.info('Starting Software Knowledge Graph');
  
  try {
    // Log configuration values for debugging
    logConfigValues(logger);
    
    // Initialize database connection
    logger.info('Connecting to Neo4j database...');
    const db = new Neo4jConnection(getNeo4jConfig());
    await db.initialize();
    
    // Get database stats
    const stats = await db.getKnowledgeGraphStats();
    logger.info('Knowledge graph database stats:', stats);
    
    logger.info('Software Knowledge Graph is ready!');
    logger.info('To seed the knowledge graph, use:');
    logger.info('  npm run seed');
    logger.info('  npm run seed:clear (to clear existing data first)');
    
    // Keep the process running until explicitly terminated
    logger.info('Press Ctrl+C to exit');
    
    // Close connection when process is terminated
    process.on('SIGINT', async () => {
      logger.info('Closing database connection...');
      await db.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to initialize:', error);
    process.exit(1);
  }
}

// Execute the main function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error in main function', { error });
    process.exit(1);
  });
}

// Export for importing elsewhere
export { main }; 