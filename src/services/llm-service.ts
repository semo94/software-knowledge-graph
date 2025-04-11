import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { logger } from '../utils/logger.js';
import { extractJSON } from '../utils/json-parser.js';
import { LlmServiceConfig, PromptConfig, SeedingConfig } from '../types/index.js';
import { setTimeout } from 'timers/promises';

export class LlmService {
  private model: BaseChatModel;
  private provider: string;

  constructor(config: LlmServiceConfig) {
    this.provider = config.provider;

    // Initialize the appropriate LangChain model based on provider
    if (config.provider === 'anthropic') {
      this.model = new ChatAnthropic({
        anthropicApiKey: config.apiKey,
        modelName: config.modelName,
        temperature: Number(config.temperature),
        maxTokens: Number(config.maxTokens),
      });
    } else {
      // Default to OpenAI
      this.model = new ChatOpenAI({
        openAIApiKey: config.apiKey,
        modelName: config.modelName,
        temperature: Number(config.temperature),
        maxTokens: Number(config.maxTokens),
      });
    }

    logger.debug('LLM Service initialized with LangChain', {
      provider: config.provider,
      modelName: config.modelName
    });
  }

  /**
   * General purpose text analysis method for knowledge graph seeding
   * @param prompt The prompt to analyze
   * @returns The LLM's response text
   */
  async analyzeText(prompt: string): Promise<string> {
    logger.debug('Analyzing text for knowledge graph seeding', { promptLength: prompt.length });

    try {
      // Use LangChain model with a simple prompt structure
      const response = await this.model.call([
        new HumanMessage(prompt)
      ]);

      const content = response.content.toString();
      return content;
    } catch (error) {
      logger.error('Error in text analysis for knowledge graph seeding', { error });
      throw new Error(`LLM analysis failed: ${(error as Error).message}`);
    }
  }

  /**
   * Text analysis with prefilled response for better structured output
   * @param prompt The prompt to analyze
   * @param prefill The text to prefill in the assistant's response
   * @returns The LLM's response including the prefill
   */
  async analyzeTextWithPrefill(prompt: string, prefill: string): Promise<string> {
    logger.debug('Analyzing text with prefill for knowledge graph seeding', {
      promptLength: prompt.length,
      prefillLength: prefill.length
    });

    try {
      // For Anthropic models, we can directly use the prefill approach with message history
      if (this.provider === 'anthropic') {
        const response = await this.model.call([
          new HumanMessage(prompt),
          new AIMessage(prefill)
        ]);

        // Combine the prefill with the model's completion
        return prefill + response.content.toString();
      }
      // For OpenAI, we need to use a different approach with a system message
      else {
        // Create a system message instructing the model to continue from the prefill
        const systemPrompt = `
          You are an expert programming education assistant.
          You must continue your response exactly from this starting text: "${prefill}"
          Do not repeat any part of the starting text - just continue from it.
          Do not include any additional text, explanations, or markdown formatting, just the JSON structure.
        `;

        const response = await this.model.call([
          new SystemMessage(systemPrompt),
          new HumanMessage(prompt)
        ]);

        const content = response.content.toString();

        // Check if the response actually includes the prefill
        if (content.startsWith(prefill)) {
          return content;
        } else {
          // If not, manually prepend it, checking for potential overlap
          const prefixLength = Math.min(prefill.length, content.length);
          let overlapLength = 0;

          // Check for partial overlap between prefill and response
          for (let i = 1; i <= prefixLength; i++) {
            if (prefill.slice(-i) === content.slice(0, i)) {
              overlapLength = i;
            }
          }

          // Combine with appropriate deduplication
          if (overlapLength > 0) {
            return prefill + content.slice(overlapLength);
          } else {
            return prefill + content;
          }
        }
      }
    } catch (error) {
      logger.error('Error in text analysis with prefill', { error });
      throw new Error(`LLM analysis with prefill failed: ${(error as Error).message}`);
    }
  }

  /**
   * Makes LLM requests with retry logic and improved JSON parsing
   * @param promptConfig Object containing primary, fallback prompts and prefill
   * @param config Seeding configuration with retry settings
   * @param retryCount Current retry attempt
   * @returns Parsed JSON result or null if parsing fails
   */
  async makeLlmRequest<T>(
    promptConfig: PromptConfig,
    config: SeedingConfig,
    retryCount: number = 0
  ): Promise<T | null> {
    try {
      const { primaryPrompt, prefill, fallbackPrompt } = promptConfig;
      
      // For first attempt, use the primary prompt, with optional prefill
      let response;
      if (prefill && retryCount === 0) {
        // Use prefill technique if provided and this is the first attempt
        response = await this.analyzeTextWithPrefill(primaryPrompt, prefill);
      } else if (fallbackPrompt && retryCount > 0 && config.useSimplifiedFallbacks) {
        // Use simplified fallback prompt on retries if available
        response = await this.analyzeText(fallbackPrompt);
      } else {
        // Standard request
        response = await this.analyzeText(primaryPrompt);
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

        return this.makeLlmRequest<T>(promptConfig, config, retryCount + 1);
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

        return this.makeLlmRequest<T>(promptConfig, config, retryCount + 1);
      }

      return null;
    }
  }
}
