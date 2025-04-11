/**
 * Database utility functions for common operations
 */

import { logger } from './logger.js';
import { Neo4jConnection } from '../database/neo4j-connector.js';

/**
 * Get existing top-level domains from the database
 */
export async function getExistingDomains(db: Neo4jConnection): Promise<any[]> {
  let existingDomains: any[] = [];
  try {
    // Check if we have domains in the database already
    const stats = await db.getKnowledgeGraphStats();
    if (stats.unitCount > 0) {
      // Get a list of existing top-level domains
      const session = db.driver.session();
      try {
        const result = await session.run(`
          MATCH (ku:KnowledgeUnit {type: 'domain'})
          WHERE NOT (:KnowledgeUnit)-[:CONTAINS]->(ku)
          RETURN ku.name AS name, ku.description AS description, ku.complexity AS complexity
          LIMIT 20
        `);
        existingDomains = result.records.map(record => ({
          name: record.get('name'),
          description: record.get('description'),
          complexity: db.toNumber(record.get('complexity'))
        }));
        logger.info(`Found ${existingDomains.length} existing top-level domains in database`);
      } finally {
        session.close();
      }
    }
  } catch (error) {
    logger.warn('Error querying existing domains, proceeding without existing domain context', { error });
  }
  
  return existingDomains;
}

/**
 * Get existing child units for a parent unit
 */
export async function getExistingChildUnits(db: Neo4jConnection, parentName: string): Promise<any[]> {
  let existingChildren: any[] = [];
  try {
    // Get units already contained by this parent
    const session = db.driver.session();
    try {
      const result = await session.run(`
        MATCH (parent:KnowledgeUnit {name: $parentName})
        MATCH (parent)-[:CONTAINS]->(child:KnowledgeUnit)
        RETURN child.name AS name, child.type AS type, child.description AS description
        LIMIT 30
      `, { parentName });

      existingChildren = result.records.map(record => ({
        name: record.get('name'),
        type: record.get('type'),
        description: record.get('description'),
      }));

      logger.info(`Found ${existingChildren.length} existing child units for: ${parentName}`);
    } finally {
      session.close();
    }
  } catch (error) {
    logger.warn(`Error querying existing child units for: ${parentName}, proceeding without child context`, { error });
  }
  
  return existingChildren;
}

/**
 * Get existing relationships for a unit
 */
export async function getExistingRelationships(db: Neo4jConnection, unitName: string): Promise<any[]> {
  let existingRelationships: any[] = [];
  try {
    const session = db.driver.session();
    try {
      const result = await session.run(`
        MATCH (unit:KnowledgeUnit {name: $unitName})
        MATCH (unit)-[r]->(other:KnowledgeUnit)
        RETURN type(r) AS relType, other.name AS otherName, r.strength AS strength, r.explanation AS explanation
        UNION
        MATCH (unit:KnowledgeUnit {name: $unitName})
        MATCH (other:KnowledgeUnit)-[r]->(unit)
        RETURN type(r) AS relType, other.name AS otherName, r.strength AS strength, r.explanation AS explanation
        LIMIT 50
      `, { unitName });

      existingRelationships = result.records.map(record => ({
        type: record.get('relType').toLowerCase(),
        otherName: record.get('otherName'),
        strength: record.get('strength'),
        explanation: record.get('explanation')
      }));

      logger.info(`Found ${existingRelationships.length} existing relationships for unit: ${unitName}`);
    } finally {
      session.close();
    }
  } catch (error) {
    logger.warn(`Error querying existing relationships for unit: ${unitName}, proceeding without relationship context`, { error });
  }
  
  return existingRelationships;
}

/**
 * Get a sample of random units from the database
 */
export async function getSampleUnits(db: Neo4jConnection, limit: number, excludeUnit?: string): Promise<string[]> {
  let units: string[] = [];
  try {
    const session = db.driver.session();
    try {
      // Get some random units from the database
      const result = await session.run(`
        MATCH (ku:KnowledgeUnit)
        ${excludeUnit ? 'WHERE ku.name <> $excludeUnit' : ''}
        RETURN ku.name AS name, ku.type AS type
        ORDER BY rand()
        LIMIT ${Number(limit) }
      `, { excludeUnit });

      units = result.records.map(record => `${record.get('name')} (${record.get('type')})`);
    } finally {
      session.close();
    }
  } catch (error) {
    logger.warn(`Error fetching sample units from database`, { error });
  }
  
  return units;
}
