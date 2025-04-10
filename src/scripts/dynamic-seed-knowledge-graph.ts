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
 * @module dynamic-seed-knowledge-graph
 */

import { Neo4jConnection, KnowledgeUnitData, RelationshipData } from '../database/neo4j-connector.js';
import { LlmService } from '../services/llm-service.js';
import { getNeo4jConfig, getLlmConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { extractJSON } from '../utils/json-parser.js';
import { setTimeout } from 'timers/promises';

/**
 * Configuration for the seeding process
 */
interface SeedingConfig {
  // Maximum depth for recursive exploration (0 = just seed domains)
  maxExplorationDepth: number;

  // Number of child units to explore per parent unit
  childrenPerUnit: number;

  // Number of relationships to generate per unit
  relationshipsPerUnit: number;

  // Maximum total entities to create (0 = unlimited)
  maxTotalEntities: number;

  // Delay between LLM calls in milliseconds
  llmCallDelay: number;

  // Whether to clear existing data before seeding
  clearExistingData: boolean;

  // Whether to perform validation using additional LLM calls
  enableValidation: boolean;

  // Number of retries for failed LLM parsing
  maxRetries: number;

  // Whether to use simplified prompts after initial failure
  useSimplifiedFallbacks: boolean;
}

// Default configuration
const defaultConfig: SeedingConfig = {
  maxExplorationDepth: 3,
  childrenPerUnit: 3,
  relationshipsPerUnit: 5,
  maxTotalEntities: 200, // Prevent runaway exploration
  llmCallDelay: 1000,
  clearExistingData: false,
  enableValidation: true,
  maxRetries: 3,
  useSimplifiedFallbacks: true
};

/**
 * Tracking structure for already processed entities
 */
interface ProcessedEntities {
  units: Set<string>;
  relationships: Set<string>; // format: "source|target|type"
  count: {
    units: number;
    relationships: number;
  };
}

/**
 * Initialize tracking for processed entities
 */
function initProcessedEntities(): ProcessedEntities {
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
function reachedEntityLimit(processed: ProcessedEntities, config: SeedingConfig): boolean {
  if (config.maxTotalEntities === 0) return false;
  return processed.count.units >= config.maxTotalEntities;
}

/**
 * Helper function to make LLM API calls with retry logic and improved JSON parsing
 */
async function makeLlmRequest<T>(
  llm: LlmService,
  prompt: string,
  prefill: string | null = null,
  fallbackPrompt: string | null = null,
  config: SeedingConfig,
  retryCount: number = 0
): Promise<T | null> {
  try {
    // For first attempt, use the primary prompt, with optional prefill
    let response;
    if (prefill && retryCount === 0) {
      // Use prefill technique if provided and this is the first attempt
      response = await llm.analyzeTextWithPrefill(prompt, prefill);
    } else if (fallbackPrompt && retryCount > 0 && config.useSimplifiedFallbacks) {
      // Use simplified fallback prompt on retries if available
      response = await llm.analyzeText(fallbackPrompt);
    } else {
      // Standard request
      response = await llm.analyzeText(prompt);
    }
    // Extract and parse JSON using the utility function
    const parsed = extractJSON(response);
    logger.info('PARSED', parsed);

    if (parsed) {
      return parsed as T;
    }

    // Retry logic
    if (retryCount < config.maxRetries) {
      logger.warn(`Failed to parse JSON from LLM (attempt ${retryCount + 1}/${config.maxRetries + 1}), retrying...`);

      // Exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
      await setTimeout(backoffTime);

      return makeLlmRequest<T>(llm, prompt, prefill, fallbackPrompt, config, retryCount + 1);
    }

    logger.error('All retry attempts failed to extract valid JSON');
    return null;
  } catch (error) {
    logger.error('Error making LLM request', { error });

    // Retry logic for errors
    if (retryCount < config.maxRetries) {
      logger.warn(`LLM request error (attempt ${retryCount + 1}/${config.maxRetries + 1}), retrying...`);

      // Exponential backoff
      const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
      await setTimeout(backoffTime);

      return makeLlmRequest<T>(llm, prompt, prefill, fallbackPrompt, config, retryCount + 1);
    }

    return null;
  }
}

/**
 * Main function to dynamically seed the knowledge graph
 */
async function seedKnowledgeGraphDynamically(
  db: Neo4jConnection,
  llm: LlmService,
  config: SeedingConfig = defaultConfig
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
 * Discover seed domains using LLM
 */
async function discoverSeedDomains(
  llm: LlmService,
  db: Neo4jConnection,
  config: SeedingConfig
): Promise<KnowledgeUnitData[]> {
  logger.info('Discovering seed domains');

  // First, query existing top-level domains from the database
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
          complexity: record.get('complexity').toNumber(),
        }));
        logger.info(`Found ${existingDomains.length} existing top-level domains in database`);
      } finally {
        session.close();
      }
    }
  } catch (error) {
    logger.warn('Error querying existing domains, proceeding without existing domain context', { error });
  }

  const existingDomainsContext = existingDomains.length > 0
    ? `
THE FOLLOWING DOMAINS ALREADY EXIST IN THE KNOWLEDGE GRAPH:
${existingDomains.map(d => `- ${d.name}: ${d.description}`).join('\n')}

IMPORTANT: DO NOT DUPLICATE OR RECREATE ANY OF THE ABOVE DOMAINS.
Instead, focus on identifying ADDITIONAL domains that would complement the existing ones.`
    : '';

  const prompt = `
You are an expert computer science educator creating a knowledge graph for learning programming.

I need you to generate 10-12 high-level programming domains that would form the core of a programming education knowledge graph.
${existingDomainsContext}

For each NEW domain, provide:
1. name: A clear, specific name for the programming domain
2. type: Should be "domain" for these high-level entries
3. description: A concise description (1-2 sentences) of this programming domain
4. complexity: A number (1-5) indicating the overall complexity level

Ensure diversity across:
- Programming languages (both popular and foundational)
- Core CS concepts (algorithms, data structures, etc.)
- Programming paradigms
- Applied domains (web, mobile, data science, etc.)

Focus on domains that together would give a comprehensive overview of modern programming.

<example>
[
  {
    "name": "Python Programming",
    "type": "domain",
    "description": "A versatile high-level programming language known for readability and wide range of applications in web development, data science, and automation.",
    "complexity": 2
  },
  {
    "name": "Data Structures",
    "type": "domain",
    "description": "Fundamental ways to organize and store data for efficient access and modification, including arrays, linked lists, trees, and graphs.",
    "complexity": 3
  },
  {
    "name": "Object-Oriented Programming",
    "type": "domain",
    "description": "A programming paradigm based on objects containing data and behavior, emphasizing concepts like encapsulation, inheritance, and polymorphism.",
    "complexity": 3
  }
]
</example>

Return a valid JSON array of domain objects. Do not include any additional text, explanations, or markdown formatting in your response, just the JSON array.
`;

  // Prefill to help Claude generate valid JSON
  const prefill = `[
  {
    "name": "`;

  // Simplified fallback prompt if the first attempt fails
  const fallbackPrompt = `
You are a computer science educator. Generate 5 programming domains in a valid JSON array format.
Each domain should have: name, type (always "domain"), description (1-2 sentences), and complexity (1-5).

Return ONLY a JSON array with no other text or explanations.

Example:
[
  {
    "name": "Python Programming",
    "type": "domain",
    "description": "High-level programming language with broad applications",
    "complexity": 2
  }
]
`;

  try {
    const domains = await makeLlmRequest<any[]>(llm, prompt, prefill, fallbackPrompt, config);

    if (domains && Array.isArray(domains)) {
      // Validate and format domains
      return domains.map((domain: any) => ({
        name: domain.name,
        type: "domain",
        description: domain.description || `A programming domain focused on ${domain.name}`,
        complexity: domain.complexity || 3
      }));
    } else {
      logger.error('Failed to generate seed domains with LLM');

      // Fallback to basic seed domains
      return [
        {
          name: "Python Programming",
          type: "domain",
          description: "A versatile high-level programming language known for readability and wide applications.",
          complexity: 2
        },
        {
          name: "Web Development",
          type: "domain",
          description: "Building and maintaining websites and web applications using various technologies.",
          complexity: 3
        },
        {
          name: "Data Structures and Algorithms",
          type: "domain",
          description: "Fundamental ways to organize data and solve computational problems efficiently.",
          complexity: 4
        }
      ];
    }
  } catch (error) {
    logger.error('Error generating seed domains with LLM', { error });

    // Return minimal fallback domains
    return [
      {
        name: "Programming Fundamentals",
        type: "domain",
        description: "Core concepts and principles of programming applicable across languages.",
        complexity: 1
      },
      {
        name: "Software Engineering",
        type: "domain",
        description: "Professional practices for developing maintainable, scalable software systems.",
        complexity: 3
      }
    ];
  }
}

/**
 * Process a knowledge unit, create it, and explore its relationships
 */
async function processKnowledgeUnit(
  db: Neo4jConnection,
  llm: LlmService,
  unit: KnowledgeUnitData,
  depth: number,
  processed: ProcessedEntities,
  config: SeedingConfig
): Promise<void> {
  // Check if we've already processed this unit
  if (processed.units.has(unit.name)) {
    logger.debug(`Knowledge unit already processed: ${unit.name}`);
    return;
  }

  logger.info(`Processing knowledge unit: ${unit.name} (depth ${depth})`);

  try {
    // Create the knowledge unit
    await db.createKnowledgeUnit(unit);
    processed.units.add(unit.name);
    processed.count.units++;
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

        // Create a unique key for this relationship
        const relationshipKey = `${rel.sourceName}|${rel.targetName}|${rel.type}`;
        if (processed.relationships.has(relationshipKey)) continue;

        try {
          // Create the relationship
          await db.createRelationship(rel);
          processed.relationships.add(relationshipKey);
          processed.count.relationships++;
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
 * Discover child units for a given parent unit using LLM
 */
async function discoverChildUnits(
  llm: LlmService,
  parentUnit: KnowledgeUnitData,
  count: number,
  db: Neo4jConnection,
  config: SeedingConfig
): Promise<KnowledgeUnitData[]> {
  logger.info(`Discovering ${count} child units for: ${parentUnit.name}`);

  // Query existing child units for this parent
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
      `, { parentName: parentUnit.name });

      existingChildren = result.records.map(record => ({
        name: record.get('name'),
        type: record.get('type'),
        description: record.get('description'),
      }));

      logger.info(`Found ${existingChildren.length} existing child units for: ${parentUnit.name}`);
    } finally {
      session.close();
    }
  } catch (error) {
    logger.warn(`Error querying existing child units for: ${parentUnit.name}, proceeding without child context`, { error });
  }

  const existingChildrenContext = existingChildren.length > 0
    ? `
THE FOLLOWING CHILD UNITS ALREADY EXIST UNDER THIS PARENT IN THE KNOWLEDGE GRAPH:
${existingChildren.map(c => `- ${c.name} (${c.type}): ${c.description}`).join('\n')}

IMPORTANT: DO NOT DUPLICATE OR RECREATE ANY OF THE ABOVE UNITS.
Instead, focus on identifying ADDITIONAL units that would complement the existing ones.`
    : '';

  // Determine appropriate child type based on parent type
  let childType = "topic";
  if (parentUnit.type === "topic") {
    childType = "concept";
  } else if (parentUnit.type === "subject") {
    childType = "topic";
  }

  const prompt = `
You are an expert computer science educator creating a knowledge graph for learning programming.

Generate ${count} important child units that are contained within the parent unit: "${parentUnit.name}" (${parentUnit.type}).
${existingChildrenContext}

For each NEW child unit, provide:
1. name: A clear, specific name for this unit (should be more specific than the parent)
2. type: "${childType}" for these child entries
3. description: A concise description (1-2 sentences) explaining this unit
4. complexity: A number (1-5) indicating the complexity level (usually same or higher than ${parentUnit.complexity})

The parent unit is described as: "${parentUnit.description}"

<example>
[
  {
    "name": "List Comprehensions",
    "type": "${childType}",
    "description": "A concise syntax for creating lists based on existing lists or iterable objects in Python.",
    "complexity": 3
  },
  {
    "name": "Lambda Functions",
    "type": "${childType}",
    "description": "Anonymous, inline functions defined using the lambda keyword, used for short, simple operations.",
    "complexity": 3
  }
]
</example>

Ensure these child units:
- Are more specialized than the parent "${parentUnit.name}"
- Together cover important specialized areas within "${parentUnit.name}"
- Are at an appropriate level of granularity (not too broad, not too narrow)

Return a valid JSON array of unit objects. Do not include any additional text, explanations, or markdown formatting in your response, just the JSON array.
`;

  // Prefill to help Claude generate valid JSON
  const prefill = `[
  {
    "name": "`;

  // Simplified fallback prompt if the first attempt fails
  const fallbackPrompt = `
You are a computer science educator. Generate ${count} child units for "${parentUnit.name}" in a valid JSON array.

Each unit should have: name, type ("${childType}"), description (1-2 sentences), and complexity (1-5).

Return ONLY a JSON array with no other text or explanations.

Example:
[
  {
    "name": "List Comprehensions",
    "type": "${childType}",
    "description": "A concise way to create lists in Python",
    "complexity": 3
  }
]
`;

  try {
    const childUnits = await makeLlmRequest<any[]>(llm, prompt, prefill, fallbackPrompt, config);

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
          type: unit.type || childType,
          description: unit.description || `A ${childType} within ${parentUnit.name}`,
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
 * Discover relationships for a knowledge unit using LLM
 */
async function discoverRelationships(
  llm: LlmService,
  unit: KnowledgeUnitData,
  db: Neo4jConnection,
  processed: ProcessedEntities,
  config: SeedingConfig
): Promise<RelationshipData[]> {
  logger.info(`Discovering relationships for unit: ${unit.name}`);

  // Query existing relationships for this unit
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
      `, { unitName: unit.name });

      existingRelationships = result.records.map(record => ({
        type: record.get('relType').toLowerCase(),
        otherName: record.get('otherName'),
        strength: record.get('strength'),
        explanation: record.get('explanation')
      }));

      logger.info(`Found ${existingRelationships.length} existing relationships for unit: ${unit.name}`);
    } finally {
      session.close();
    }
  } catch (error) {
    logger.warn(`Error querying existing relationships for unit: ${unit.name}, proceeding without relationship context`, { error });
  }

  // Get a list of known units to suggest realistic relationships
  let knownUnits = Array.from(processed.units)
    .filter(name => name !== unit.name) // Exclude self
    .sort(() => 0.5 - Math.random()) // Shuffle
    .slice(0, 15); // Take a random sample of known units

  // If we have few in-memory units, fetch some from the database
  if (knownUnits.length < 10) {
    try {
      const session = db.driver.session();
      try {
        // Get some random units from the database
        const result = await session.run(`
          MATCH (ku:KnowledgeUnit)
          WHERE ku.name <> $unitName
          RETURN ku.name AS name, ku.type AS type
          ORDER BY rand()
          LIMIT 15
        `, { unitName: unit.name });

        const dbUnits = result.records.map(record => record.get('name'));

        // Combine with known units, removing duplicates
        knownUnits = Array.from(new Set([...knownUnits, ...dbUnits])).slice(0, 15);
      } finally {
        session.close();
      }
    } catch (error) {
      logger.warn(`Error fetching additional units from database, continuing with in-memory units`, { error });
    }
  }

  const existingRelationshipsContext = existingRelationships.length > 0
    ? `
THE FOLLOWING RELATIONSHIPS ALREADY EXIST FOR THIS UNIT IN THE KNOWLEDGE GRAPH:
${existingRelationships.map(r => {
      return `- Relationship: ${r.type.toUpperCase()}, With: ${r.otherName}, Strength: ${r.strength || '?'}, Explanation: ${r.explanation || 'N/A'}`;
    }).join('\n')}

IMPORTANT: DO NOT DUPLICATE OR RECREATE ANY OF THE ABOVE RELATIONSHIPS.
Instead, focus on identifying ADDITIONAL relationships that would complement the existing ones.`
    : '';

  const prompt = `
You are an expert computer science educator creating a knowledge graph for learning programming.

I need to establish relationships for the programming unit "${unit.name}" (${unit.type}).
Description: "${unit.description}"
${existingRelationshipsContext}

There are three types of relationships to identify:
1. CONTAINS: Parent unit contains/includes the child unit (hierarchical relationship)
2. REQUIRES: Unit requires knowledge of another unit as a prerequisite
3. RELATED_TO: Units that are related but not in a hierarchical or prerequisite relationship

For each NEW relationship, provide:
- sourceName: Source unit name (often "${unit.name}" but not always)
- targetName: Target unit name
- type: Relationship type (contains, requires, or related_to)
- strength: Importance of the relationship (0.1-1.0)
- explanation: Brief explanation of how these units are related

Some existing units in the knowledge graph that might be related:
${knownUnits.map(name => `- ${name}`).join('\n')}

You can also suggest new units if they have important relationships with "${unit.name}".

I need ${config.relationshipsPerUnit} total relationships, with a mix of:
1. "${unit.name}" CONTAINS other units (if appropriate for this unit type)
2. "${unit.name}" REQUIRES prerequisite units (what must someone know first)
3. Other units that REQUIRE "${unit.name}" (what is this a prerequisite for)
4. Units RELATED_TO "${unit.name}" in various ways

<example>
[
  {
    "sourceName": "Object-Oriented Programming",
    "targetName": "Classes",
    "type": "contains",
    "strength": 0.9,
    "explanation": "Classes are a fundamental component of the OOP paradigm"
  },
  {
    "sourceName": "Inheritance",
    "targetName": "Object-Oriented Programming",
    "type": "requires",
    "strength": 0.8,
    "explanation": "Understanding OOP is essential before learning inheritance concepts"
  },
  {
    "sourceName": "Functional Programming",
    "targetName": "Object-Oriented Programming",
    "type": "related_to",
    "strength": 0.6,
    "explanation": "These are alternative programming paradigms with different approaches"
  }
]
</example>

Return a valid JSON array of relationship objects. Choose relationships that make pedagogical sense for a learning path.
Do not include any additional text, explanations, or markdown formatting in your response, just the JSON array.
`;

  // Prefill to help Claude generate valid JSON
  const prefill = `[
  {
    "sourceName": "`;

  // Simplified fallback prompt if the first attempt fails
  const fallbackPrompt = `
You are a computer science educator. Generate ${config.relationshipsPerUnit} relationships for the unit "${unit.name}" in a valid JSON array.

Include relationships of types: contains, requires, related_to

Each relationship should have: sourceName, targetName, type, strength (0.1-1.0), and explanation.

Return ONLY a JSON array with no other text or explanations.

Example:
[
  {
    "sourceName": "Object-Oriented Programming",
    "targetName": "Classes",
    "type": "contains",
    "strength": 0.9,
    "explanation": "Classes are core to OOP"
  }
]
`;

  try {
    const relationships = await makeLlmRequest<any[]>(llm, prompt, prefill, fallbackPrompt, config);

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
          // Check for duplicates with existing relationships
          const relationshipKey = `${rel.sourceName}|${rel.targetName}|${rel.type}`;
          return !processed.relationships.has(relationshipKey);
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

/**
 * Validate the knowledge graph for consistency using LLM
 */
async function validateKnowledgeGraph(
  db: Neo4jConnection,
  llm: LlmService,
  processed: ProcessedEntities,
  config: SeedingConfig
): Promise<void> {
  logger.info('Validating knowledge graph for consistency');

  // Get database stats
  const stats = await db.getKnowledgeGraphStats();

  // Sample units for validation
  let units: string[] = [];
  try {
    const session = db.driver.session();
    try {
      const result = await session.run(`
        MATCH (ku:KnowledgeUnit)
        RETURN ku.name AS name, ku.type AS type
        ORDER BY rand()
        LIMIT 20
      `);

      units = result.records.map(record => `${record.get('name')} (${record.get('type')})`);
    } finally {
      session.close();
    }
  } catch (error) {
    // Fallback to in-memory units if database query fails
    units = Array.from(processed.units)
      .sort(() => 0.5 - Math.random())
      .slice(0, 20);

    logger.warn('Error querying units for validation, using in-memory units', { error });
  }

  const prompt = `
You are an expert computer science educator validating a programming knowledge graph.

I've created a knowledge graph with:
- ${stats.unitCount} knowledge units (domains, subjects, topics, concepts)
- ${stats.containsCount} contains relationships
- ${stats.requiresCount} requires relationships
- ${stats.relatedToCount} related_to relationships

Here's a sample of units in the graph:
${units.join('\n')}

Please evaluate the consistency and quality of this knowledge graph:
1. Are there any obvious gaps in fundamental programming concepts?
2. Are there any units that seem out of place or incorrectly categorized?
3. Based on the unit names, what recommendations do you have for improving the knowledge graph?

Return a valid JSON with your assessment and specific actionable recommendations.

<example>
{
  "assessment": "The knowledge graph appears to have good coverage of web development concepts and data structures, but may lack sufficient algorithms and systems programming concepts.",
  "gaps": [
    "Basic algorithms (sorting, searching)",
    "Computer architecture fundamentals",
    "Memory management concepts"
  ],
  "issues": [
    "Some concepts like 'Dynamic Imports' may be too specific without more foundational JavaScript concepts",
    "React Hooks concepts exist but don't appear to connect properly to basic React concepts"
  ],
  "recommendations": [
    "Add core algorithms concepts (time complexity, space complexity)",
    "Ensure proper hierarchy between basic and advanced concepts",
    "Add more connections between related language concepts across domains"
  ]
}
</example>

Return a JSON object with your evaluation. Do not include any additional text, explanations, or markdown formatting in your response, just the JSON object.
`;

  // Prefill to help Claude generate valid JSON
  const prefill = `{
  "assessment": "`;

  // Simplified fallback prompt if the first attempt fails
  const fallbackPrompt = `
You are a computer science educator. Evaluate this knowledge graph sample for gaps and issues.

Review these units:
${units.join('\n')}

What fundamental concepts might be missing? Are any units out of place? What improvements would you recommend?

Return ONLY a JSON object with fields: assessment, gaps, issues, and recommendations.
No other text or explanations.
`;

  try {
    const validation = await makeLlmRequest<any>(llm, prompt, prefill, fallbackPrompt, config);

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

/**
 * Main execution function
 */
async function main() {
  logger.info('Starting dynamic knowledge graph seeding script');

  try {
    // Parse command line arguments for configuration
    const args = process.argv.slice(2);
    const clearArg = args.find(arg => arg === '--clear');
    const depthArg = args.find(arg => arg.startsWith('--depth='));
    const limitArg = args.find(arg => arg.startsWith('--limit='));
    const skipValidationArg = args.find(arg => arg === '--skip-validation');
    const retriesArg = args.find(arg => arg.startsWith('--retries='));
    const noFallbacksArg = args.find(arg => arg === '--no-fallbacks');

    const config: SeedingConfig = {
      ...defaultConfig,
      clearExistingData: !!clearArg,
      maxExplorationDepth: depthArg
        ? parseInt(depthArg.split('=')[1], 10)
        : defaultConfig.maxExplorationDepth,
      maxTotalEntities: limitArg
        ? parseInt(limitArg.split('=')[1], 10)
        : defaultConfig.maxTotalEntities,
      enableValidation: !skipValidationArg,
      maxRetries: retriesArg
        ? parseInt(retriesArg.split('=')[1], 10)
        : defaultConfig.maxRetries,
      useSimplifiedFallbacks: !noFallbacksArg
    };

    // Initialize database connection
    const db = new Neo4jConnection(getNeo4jConfig());
    await db.initialize();

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
  discoverSeedDomains,
  discoverChildUnits,
  discoverRelationships,
  SeedingConfig
};