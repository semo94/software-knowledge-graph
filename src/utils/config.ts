/**
 * Server configuration values - can be overridden by environment variables
 */

// Basic application information
export const APP_NAME = process.env.APP_NAME || "software-knowledge-graph";
export const APP_VERSION = process.env.APP_VERSION || "1.0.0";

// Logger configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";
// Safely handle LOG_DIR 
export const LOG_DIR = (() => {
  const dirPath = process.env.LOG_DIR || "logs";
  // If it's an absolute path, use it as is
  // If it's a relative path, keep it as is (it will be resolved relative to CWD later)
  return dirPath;
})();
export const LOG_FILE = process.env.LOG_FILE || "combined.log";
export const ERROR_LOG_FILE = process.env.ERROR_LOG_FILE || "error.log";
export const ENABLE_FILE_LOGGING = process.env.ENABLE_FILE_LOGGING === "true" || process.env.NODE_ENV !== "development";

// Neo4j configuration values
export const NEO4J_URI = process.env.NEO4J_URI || "neo4j://localhost:7687";
export const NEO4J_USERNAME = process.env.NEO4J_USERNAME || "neo4j";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "password";

// LLM configuration values
export const LLM_PROVIDER = (process.env.LLM_PROVIDER as 'anthropic' | 'openai') || 'anthropic';
export const LLM_API_KEY = process.env.LLM_API_KEY || '';
export const LLM_MODEL_NAME = process.env.LLM_MODEL_NAME || 'claude-3-opus-20240229';
export const LLM_TEMPERATURE = process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0;
export const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages';
export const LLM_MAX_TOKENS = process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : 1000;

/**
 * Get Neo4j database configuration object
 * @returns Neo4j connection configuration
 */
export function getNeo4jConfig() {
  return {
    uri: NEO4J_URI,
    username: NEO4J_USERNAME,
    password: NEO4J_PASSWORD
  };
}

/**
 * Get LLM service configuration object
 * @returns LLM service configuration using LangChain
 */
export function getLlmConfig() {
  return {
    provider: LLM_PROVIDER,
    apiKey: LLM_API_KEY,
    modelName: LLM_MODEL_NAME,
    temperature: LLM_TEMPERATURE,
    endpoint: LLM_ENDPOINT,
    maxTokens: LLM_MAX_TOKENS
  };
}

/**
 * Logs all configuration values and environment variables
 * This is useful for debugging and verifying the application configuration
 */
export function logConfigValues(logger: any) {
  // Helper function to format objects as JSON strings
  const formatObject = (obj: Record<string, any>): string => {
    return JSON.stringify(obj, null, 2);
  };
  
  // Application configuration values
  logger.info('=== APPLICATION CONFIGURATION ===');
  logger.info(formatObject({
    APP_NAME,
    APP_VERSION,
    LOG_LEVEL,
    LOG_DIR,
    LOG_FILE,
    ERROR_LOG_FILE,
    ENABLE_FILE_LOGGING
  }));
  
  // Neo4j configuration values
  logger.info('=== NEO4J CONFIGURATION ===');
  logger.info(formatObject({
    NEO4J_URI,
    NEO4J_USERNAME,
    NEO4J_PASSWORD: NEO4J_PASSWORD ? '********' : 'not set'
  }));
  
  // LLM configuration values
  logger.info('=== LLM CONFIGURATION ===');
  logger.info(formatObject({
    LLM_PROVIDER,
    LLM_API_KEY: LLM_API_KEY ? '********' : 'not set',
    LLM_MODEL_NAME,
    LLM_TEMPERATURE,
    LLM_ENDPOINT,
    LLM_MAX_TOKENS
  }));
} 