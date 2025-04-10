/**
 * Helper function to extract JSON from LLM responses using multiple strategies
 * @param text The text response from an LLM
 * @returns Parsed JSON object or null if extraction fails
 */
export function extractJSON(text: string): any | null {
  // Remove potential confusing text at the beginning/end to help with extraction
  text = text.replace(/^As an AI assistant,.*?(?=\[|\{)/is, '');
  text = text.replace(/^Here is the JSON.*?(?=\[|\{)/is, '');
  text = text.replace(/^I'll generate.*?(?=\[|\{)/is, '');

  // Try multiple extraction strategies
  const strategies = [
    // Match JSON in code blocks with json tag
    /```json\n([\s\S]*?)\n```/,
    // Match JSON in code blocks without language tag
    /```\n([\s\S]*?)\n```/,
    // Match JSON in code blocks with any language tag
    /```.*?\n([\s\S]*?)\n```/,
    // Match JSON arrays directly
    /(\[\s*\{[\s\S]*\}\s*\])/,
    // Match JSON objects directly
    /(\{\s*"[^"]+"\s*:[\s\S]*\})/
  ];

  for (const pattern of strategies) {
    const match = text.match(pattern);
    if (match) {
      const jsonCandidate = match[1] || match[0];
      try {
        // Clean up the extracted text
        const cleaned = jsonCandidate
          .replace(/^```json/, '')  // Remove opening markdown if present
          .replace(/```$/, '')      // Remove closing markdown if present
          .trim();

        return JSON.parse(cleaned);
      } catch (e) {
        // Continue to next strategy if parsing fails
        continue;
      }
    }
  }

  // Last resort: try to find anything JSON-like by looking for matching brackets
  try {
    // This is a more aggressive approach that might work in some cases
    const bracketMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (bracketMatch) {
      return JSON.parse(bracketMatch[0]);
    }
  } catch (e) {
    // Failed last resort, give up
  }

  return null;
} 