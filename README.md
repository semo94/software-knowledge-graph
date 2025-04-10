# Software Knowledge Graph

A tool for creating and managing comprehensive knowledge graphs for programming and software development concepts using Neo4j.

## Overview

This tool leverages LLMs (like Claude or GPT) to automatically generate and populate a knowledge graph with programming concepts, their relationships, dependencies, and hierarchical structures. It uses Neo4j as the graph database to store and query the knowledge graph.

## Features

- Dynamic discovery of programming domains, subjects, topics, concepts, and techniques
- Automatic relationship creation (contains, requires, related_to)
- Hierarchical knowledge organization
- Validation and enhancement of knowledge graph consistency
- Command-line arguments for customizing the seeding process

## Requirements

- Node.js 22+
- Neo4j 4.4+ running locally or remotely
- LLM API access (Anthropic's Claude or OpenAI)

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and configure:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file to add your own API keys and Neo4j configuration

## Usage

### Seed a new knowledge graph:

```
npm run seed
```

### Clear existing data and create a new knowledge graph:

```
npm run seed:clear
```

### Control the seeding process with command-line arguments:

```
npm run seed -- --depth=4 --limit=500 --skip-validation
```

Available options:
- `--clear`: Clear existing data before seeding
- `--depth=N`: Maximum exploration depth (default: 3)
- `--limit=N`: Maximum total entities to create (default: 300)
- `--skip-validation`: Skip validation phase
- `--retries=N`: Number of retries for failed LLM parsing (default: 3)
- `--no-fallbacks`: Disable simplified fallback prompts
- `--skip-gap-filling`: Skip filling identified gaps in the graph
- `--skip-description-enhancement`: Skip enhancing auto-generated descriptions
- `--children-per-unit=N`: Number of child units to explore per parent (default: 4)
- `--relationships-per-unit=N`: Number of relationships per unit (default: 5)

## License

MIT 