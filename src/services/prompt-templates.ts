/**
 * Centralized prompt templates for LLM interactions
 */

import { PromptConfig, KnowledgeUnitData } from '../types/index.js';

/**
 * Generate prompt configuration for discovering seed domains
 */
export function getSeedDomainsPrompt(existingDomains: any[]): PromptConfig {
  const existingDomainsContext = existingDomains.length > 0
    ? `
THE FOLLOWING DOMAINS ALREADY EXIST IN THE KNOWLEDGE GRAPH:
${existingDomains.map(d => `- ${d.name}: ${d.description}`).join('\n')}

IMPORTANT: DO NOT DUPLICATE OR RECREATE ANY OF THE ABOVE DOMAINS.
Instead, focus on identifying ADDITIONAL domains that would complement the existing ones.`
    : '';

  const primaryPrompt = `
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

  // Prefill to help model generate valid JSON
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

  return { primaryPrompt, prefill, fallbackPrompt };
}

/**
 * Generate prompt configuration for discovering child units
 */
export function getChildUnitsPrompt(
  parentUnit: KnowledgeUnitData, 
  count: number,
  existingChildren: any[]
): PromptConfig {
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

  const primaryPrompt = `
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

  // Prefill to help model generate valid JSON
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

  return { primaryPrompt, prefill, fallbackPrompt };
}

/**
 * Generate prompt configuration for discovering relationships
 */
export function getRelationshipsPrompt(
  unit: KnowledgeUnitData,
  relationshipsPerUnit: number,
  existingRelationships: any[],
  knownUnits: string[]
): PromptConfig {
  const existingRelationshipsContext = existingRelationships.length > 0
    ? `
THE FOLLOWING RELATIONSHIPS ALREADY EXIST FOR THIS UNIT IN THE KNOWLEDGE GRAPH:
${existingRelationships.map(r => {
      return `- Relationship: ${r.type.toUpperCase()}, With: ${r.otherName}, Strength: ${r.strength || '?'}, Explanation: ${r.explanation || 'N/A'}`;
    }).join('\n')}

IMPORTANT: DO NOT DUPLICATE OR RECREATE ANY OF THE ABOVE RELATIONSHIPS.
Instead, focus on identifying ADDITIONAL relationships that would complement the existing ones.`
    : '';

  const primaryPrompt = `
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

I need ${relationshipsPerUnit} total relationships, with a mix of:
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

  // Prefill to help model generate valid JSON
  const prefill = `[
  {
    "sourceName": "`;

  // Simplified fallback prompt if the first attempt fails
  const fallbackPrompt = `
You are a computer science educator. Generate ${relationshipsPerUnit} relationships for the unit "${unit.name}" in a valid JSON array.

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

  return { primaryPrompt, prefill, fallbackPrompt };
}

/**
 * Generate prompt configuration for knowledge graph validation
 */
export function getValidationPrompt(stats: any, units: string[]): PromptConfig {
  const primaryPrompt = `
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

  // Prefill to help model generate valid JSON
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

  return { primaryPrompt, prefill, fallbackPrompt };
}
