/**
 * Type definitions for the knowledge graph seeding process
 */

/**
 * Configuration for the seeding process
 */
export interface SeedingConfig {
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

/**
 * Tracking structure for already processed entities
 */
export interface ProcessedEntities {
  units: Set<string>;
  relationships: Set<string>; // format: "source|target|type"
  count: {
    units: number;
    relationships: number;
  };
}

/**
 * LLM prompt structure
 */
export interface PromptConfig {
  primaryPrompt: string;
  prefill?: string | null;
  fallbackPrompt?: string | null;
}

/**
 * Configuration for the LLM service
 */
export interface LlmServiceConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  modelName: string;
  temperature: number;
  endpoint: string;
  maxTokens: number;
}

/**
 * Data types for the knowledge graph
 */
export interface KnowledgeUnitData {
  id?: string;
  name: string;
  type: "domain" | "subject" | "topic" | "concept" | "technique";
  description: string;
  complexity: number;
}

/**
 * Relationship data type
 */
export interface RelationshipData {
  sourceId?: string;
  sourceName?: string;
  targetId?: string;
  targetName?: string;
  type: "contains" | "requires" | "related_to";
  strength: number;
  explanation: string;
}