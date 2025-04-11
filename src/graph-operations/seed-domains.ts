/**
 * Discover seed domains for the knowledge graph
 */

import { SeedingConfig, KnowledgeUnitData } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getSeedDomainsPrompt } from '../services/prompt-templates.js';
import { LlmService } from '../services/llm-service.js';
import { getExistingDomains } from '../utils/graph-queries.js';

/**
 * Discover seed domains using LLM
 */
export async function discoverSeedDomains(
  llm: LlmService,
  db: any,
  config: SeedingConfig
): Promise<KnowledgeUnitData[]> {
  logger.info('Discovering seed domains');

  // First, query existing top-level domains from the database
  const existingDomains = await getExistingDomains(db);

  // Generate prompts for seed domains
  const promptConfig = getSeedDomainsPrompt(existingDomains);

  try {
    const domains = await llm.makeLlmRequest<any[]>(promptConfig, config);

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
