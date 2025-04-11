import neo4j from 'neo4j-driver';
import { logger } from '../utils/logger.js';
import { KnowledgeUnitData, RelationshipData } from '../types/index.js';

export class Neo4jConnection {
  driver: neo4j.Driver;

  constructor(config: { uri: string, username: string, password: string }) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password)
    );
    logger.debug('Neo4j driver initialized', { uri: config.uri });
  }

  // Helper method to execute queries with session management
  private async executeQuery<T = neo4j.QueryResult>(
    query: string,
    params: Record<string, any> = {},
    logInfo?: { success?: string, error?: string, context?: Record<string, any> }
  ): Promise<T> {
    const session = this.driver.session();
    try {
      const result = await session.run(query, params);
      logInfo?.success && logger.info(logInfo.success, { ...logInfo.context });
      return result as unknown as T;
    } catch (error) {
      logInfo?.error && logger.error(logInfo.error, { error, ...params, ...logInfo.context });
      throw error;
    } finally {
      session.close();
    }
  }

  async initialize() {
    try {
      await this.executeQuery("RETURN 1");
      logger.info('Neo4j connection established');
      await this.initializeSchema();
    } catch (error) {
      logger.error('Failed to connect to Neo4j:', { error });
      throw error;
    }
  }

  private async initializeSchema() {
    const constraints = [
      `CREATE CONSTRAINT IF NOT EXISTS FOR (ku:KnowledgeUnit) REQUIRE ku.id IS UNIQUE`,
      `CREATE CONSTRAINT IF NOT EXISTS FOR (ku:KnowledgeUnit) REQUIRE ku.name IS UNIQUE`,
      `CREATE INDEX IF NOT EXISTS FOR (ku:KnowledgeUnit) ON (ku.name)`
    ];

    for (const constraint of constraints) {
      await this.executeQuery(constraint);
    }

    logger.info('Neo4j schema initialized');
  }

  // ============= KNOWLEDGE UNIT METHODS =============
  async createKnowledgeUnit(unit: KnowledgeUnitData): Promise<KnowledgeUnitData> {
    const unitId = unit.id || crypto.randomUUID();

    await this.executeQuery(
      `
      CREATE (ku:KnowledgeUnit {
        id: $id,
        name: $name,
        type: $type,
        description: $description,
        complexity: $complexity
      })
      `,
      { ...unit, id: unitId },
      { success: 'Knowledge unit created', context: { unitName: unit.name } }
    );

    return { ...unit, id: unitId };
  }

  async knowledgeUnitExists(unitName: string): Promise<boolean> {
    const result = await this.executeQuery(
      `MATCH (ku:KnowledgeUnit {name: $unitName}) RETURN count(ku) > 0 AS exists`,
      { unitName }
    );
    return result.records[0].get('exists');
  }

  async getKnowledgeUnit(unitName: string): Promise<KnowledgeUnitData | null> {
    const result = await this.executeQuery(
      `MATCH (ku:KnowledgeUnit {name: $unitName}) RETURN ku`,
      { unitName }
    );

    if (result.records.length === 0) return null;

    const unit = result.records[0].get('ku').properties;
    return {
      id: unit.id,
      name: unit.name,
      type: unit.type,
      description: unit.description,
      complexity: this.toNumber(unit.complexity)
    };
  }

  async ensureKnowledgeUnitExists(
    unitName: string,
    type: "domain" | "subject" | "topic" | "concept" | "technique" = "concept",
    complexity: number = 3
  ): Promise<string> {
    try {
      if (await this.knowledgeUnitExists(unitName)) {
        const unit = await this.getKnowledgeUnit(unitName);
        if (!unit?.id) throw new Error(`Unit exists but could not retrieve ID for: ${unitName}`);
        return unit.id;
      }

      const unit = await this.createKnowledgeUnit({
        name: unitName,
        type,
        description: `Auto-generated ${type}: ${unitName}`,
        complexity
      });

      logger.info('Created new knowledge unit placeholder', { unitName });
      return unit.id!;
    } catch (error) {
      logger.error(`Error in ensureKnowledgeUnitExists for unit: ${unitName}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // ============= RELATIONSHIP METHODS =============
  async createRelationship(relationship: RelationshipData): Promise<void> {
    try {
      // Resolve IDs for source and target
      const sourceId = relationship.sourceId ||
        (relationship.sourceName ?
          await this.ensureKnowledgeUnitExists(relationship.sourceName) : undefined);

      const targetId = relationship.targetId ||
        (relationship.targetName ?
          await this.ensureKnowledgeUnitExists(relationship.targetName) : undefined);

      if (!sourceId || !targetId) {
        throw new Error('Source or target ID/name must be provided');
      }

      // Create the relationship
      await this.executeQuery(
        `
        MATCH (source:KnowledgeUnit {id: $sourceId})
        MATCH (target:KnowledgeUnit {id: $targetId})
        MERGE (source)-[r:${relationship.type.toUpperCase()} {
          strength: $strength,
          explanation: $explanation
        }]->(target)
        `,
        {
          sourceId,
          targetId,
          strength: relationship.strength,
          explanation: relationship.explanation
        }
      );

      logger.debug('Created relationship', {
        source: relationship.sourceName || sourceId,
        target: relationship.targetName || targetId,
        type: relationship.type
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error('Failed to create relationship', {
        error: errorMsg,
        errorStack: errorStack,
        source: relationship.sourceName || relationship.sourceId,
        target: relationship.targetName || relationship.targetId,
        type: relationship.type
      });
      throw error;
    }
  }

  async relationshipExists(
    sourceId: string,
    targetId: string,
    type: "contains" | "requires" | "related_to"
  ): Promise<boolean> {
    const result = await this.executeQuery(
      `
      MATCH (source:KnowledgeUnit {id: $sourceId})
      MATCH (target:KnowledgeUnit {id: $targetId})
      MATCH (source)-[r:${type.toUpperCase()}]->(target)
      RETURN count(r) > 0 AS exists
      `,
      { sourceId, targetId }
    );
    return result.records[0].get('exists');
  }

  // ============= UTILITY METHODS =============

  private async topologicalSortUnits(units: KnowledgeUnitData[]): Promise<KnowledgeUnitData[]> {
    const unitIds = units.map(u => u.id);
    const result = await this.executeQuery(
      `
      MATCH (source:KnowledgeUnit)-[:REQUIRES]->(target:KnowledgeUnit)
      WHERE source.id IN $unitIds AND target.id IN $unitIds
      RETURN source.id AS sourceId, target.id AS targetId
      `,
      { unitIds }
    );

    // Build adjacency list and map
    const graph: Record<string, string[]> = {};
    const idToUnit: Record<string, KnowledgeUnitData> = {};
    units.forEach(unit => {
      graph[unit.id!] = [];
      idToUnit[unit.id!] = unit;
    });

    result.records.forEach(record => {
      graph[record.get('sourceId')].push(record.get('targetId'));
    });

    // Perform topological sort
    const visited = new Set<string>();
    const sorted: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const neighbor of graph[id] || []) {
        visit(neighbor);
      }
      sorted.unshift(id);
    };

    Object.keys(graph).forEach(id => {
      if (!visited.has(id)) visit(id);
    });

    return sorted.map(id => idToUnit[id]);
  }

  async getKnowledgeGraphStats() {
    const result = await this.executeQuery(
      `
      MATCH (ku:KnowledgeUnit) 
      WITH count(ku) AS unitCount
      MATCH (ku1:KnowledgeUnit)-[r:CONTAINS]->(ku2:KnowledgeUnit)
      WITH unitCount, count(r) AS containsCount
      MATCH (ku1:KnowledgeUnit)-[r:REQUIRES]->(ku2:KnowledgeUnit)
      WITH unitCount, containsCount, count(r) AS requiresCount
      MATCH (ku1:KnowledgeUnit)-[r:RELATED_TO]->(ku2:KnowledgeUnit)
      RETURN 
        unitCount, 
        containsCount, 
        requiresCount, 
        count(r) AS relatedToCount
      `
    );

    if (result.records.length === 0) {
      return { unitCount: 0, containsCount: 0, requiresCount: 0, relatedToCount: 0 };
    }

    const record = result.records[0];
    return {
      unitCount: this.toNumber(record.get('unitCount')),
      containsCount: this.toNumber(record.get('containsCount')),
      requiresCount: this.toNumber(record.get('requiresCount')),
      relatedToCount: this.toNumber(record.get('relatedToCount'))
    };
  }

  // Helper to convert Neo4j integers to JavaScript numbers
  toNumber(value: any): number {
    return typeof value === 'object' && value.toNumber ? value.toNumber() : Number(value);
  }

  async clearDatabase() {
    await this.executeQuery('MATCH (n) DETACH DELETE n');
    logger.warn('Cleared entire database!');
  }

  async close() {
    await this.driver.close();
    logger.info('Neo4j connection closed');
  }
}