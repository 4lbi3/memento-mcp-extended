# Memento MCP Benchmark

Automated end-to-end benchmark system for evaluating the performance of Memento MCP's knowledge graph memory capabilities.

## Overview

The benchmark script performs a complete evaluation cycle consisting of three phases:

1. **Ingest Phase**: Load facts and use an LLM to interpret and store them in Memento
2. **Retrieval Phase**: Query Memento with questions and retrieve answers
3. **Evaluation Phase**: Use an LLM to evaluate retrieved answers against gold standard answers

## Features

- ✅ **Automated LLM-based evaluation**: Uses AI to simulate human interaction
- ✅ **Rate limiting**: Respects API limits with intelligent throttling
- ✅ **Retry logic**: Exponential backoff for failed API calls
- ✅ **Comprehensive reporting**: Markdown and JSON reports with detailed metrics
- ✅ **Free tier friendly**: Designed to run 4+ cycles/day on free API tiers

## Supported Models

The benchmark supports the following LLM models:

### Gemini 1.5 Flash (Recommended)
- **RPM**: 15 requests/minute
- **TPM**: 250,000 tokens/minute
- **RPD**: 1,000 requests/day

### Gemma 3
- **RPM**: 30 requests/minute
- **TPM**: 15,000 tokens/minute
- **RPD**: 14,400 requests/day

## Setup

### 1. Create Configuration File

Copy the example configuration:

```bash
cp benchmark.config.json.example benchmark.config.json
```

### 2. Configure API Keys

Edit `benchmark.config.json` and add your API keys:

```json
{
  "llm": {
    "model": "gemini-1.5-flash",
    "apiKey": "YOUR_GEMINI_API_KEY_HERE"
  },
  "embedding": {
    "openaiApiKey": "YOUR_OPENAI_API_KEY_HERE"
  },
  "mcp": {
    "serverPath": "/path/to/memento/dist/index.js",
    "neo4jUri": "bolt://127.0.0.1:7687",
    "neo4jUsername": "neo4j",
    "neo4jPassword": "your_password",
    "neo4jDatabase": "neo4j"
  }
}
```

### 3. Get API Keys

#### Gemini API Key
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy the key to your config

#### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key to your config

### 4. Ensure Neo4j is Running

Make sure your Neo4j database is running and accessible:

```bash
npm run neo4j:test
```

## Usage

### Run Benchmark

```bash
npm run benchmark
```

The script will:
1. Load configuration and validate capacity
2. Initialize Memento MCP system
3. Clean existing knowledge graph data
4. Run the three benchmark phases
5. Generate detailed reports

### Output

Reports are saved in the `benchmark-reports/` directory:

- `benchmark-report-YYYY-MM-DD-HHMMSS.md` - Human-readable Markdown report
- `benchmark-report-YYYY-MM-DD-HHMMSS.json` - Machine-readable JSON report

## Dataset

The default dataset includes:
- **10 facts** covering various topics (people, organizations, projects, etc.)
- **10 questions** with gold standard answers

### Custom Datasets

You can create custom datasets by modifying:
- `src/benchmark/data/facts.json` - Facts to ingest
- `src/benchmark/data/questions.json` - Questions and gold answers

**Important**: Keep the total number of facts + (questions × 3) under 250 to allow 4 cycles/day with Gemini 1.5 Flash.

### Dataset Format

#### facts.json
```json
[
  {
    "id": "fact_001",
    "content": "Your fact text here",
    "category": "person"
  }
]
```

#### questions.json
```json
[
  {
    "id": "q001",
    "question": "Your question here?",
    "goldAnswer": "Expected answer here",
    "category": "person",
    "relatedFactIds": ["fact_001"]
  }
]
```

## Understanding Reports

### Key Metrics

- **Overall Score**: Average of accuracy and completeness (0-100)
- **Accuracy**: How factually correct the retrieved answers are
- **Completeness**: How much of the expected information was retrieved
- **Success Rate**: Percentage of questions answered without errors

### Performance Breakdown

- **Ingest Duration**: Time to process facts and store in knowledge graph
- **Retrieval Duration**: Time to query and retrieve answers
- **Evaluation Duration**: Time to evaluate answers

### API Statistics

- **Total Requests**: Total LLM API calls made
- **Successful Requests**: Requests that succeeded
- **Failed Requests**: Requests that failed after retries
- **Retries**: Number of retry attempts

## Rate Limits and Capacity

The benchmark automatically validates that your chosen model can support the required number of cycles per day.

**Example calculation** (with default dataset):
- Facts: 10 → 10 LLM calls
- Questions: 10 → 30 LLM calls (2 for retrieval + 1 for evaluation each)
- Total per cycle: 40 LLM calls
- Cycles per day: 1000 / 40 = 25 cycles (Gemini 1.5 Flash)

## Troubleshooting

### Configuration Error

```
Error: Missing "llm.apiKey"
```

**Solution**: Ensure you've copied `benchmark.config.json.example` to `benchmark.config.json` and added your API keys.

### Rate Limit Error

```
Error: Daily request limit (1000) exceeded
```

**Solution**: Wait until the next day or reduce the dataset size.

### Embedding Timeout

```
⚠ Embedding generation timeout - proceeding with partial embeddings
```

**Solution**: This is a warning. The benchmark will continue with available embeddings. If you see this frequently, try reducing batch sizes or increasing the timeout.

### Neo4j Connection Error

```
Error: Failed to connect to Neo4j
```

**Solution**:
1. Ensure Neo4j is running: `npm run neo4j:test`
2. Check your Neo4j credentials in `benchmark.config.json`
3. Verify the Neo4j URI is correct

## Advanced Configuration

### Using Different Models

To switch between Gemini and Gemma:

```json
{
  "llm": {
    "model": "gemma-3",
    "apiKey": "YOUR_GEMINI_API_KEY_HERE"
  }
}
```

Note: Both Gemini and Gemma use the same API key from Google AI Studio.

### Custom Data Paths

```json
{
  "benchmark": {
    "factsFile": "path/to/custom/facts.json",
    "questionsFile": "path/to/custom/questions.json"
  }
}
```

## System Architecture

```
┌─────────────────┐
│  Configuration  │
└────────┬────────┘
         │
    ┌────▼─────┐
    │ LLM      │◄──── Rate Limiter
    │ Client   │      (RPM, TPM, RPD)
    └────┬─────┘
         │
    ┌────▼─────────────────────────┐
    │  Benchmark Orchestrator      │
    └──┬──────────┬─────────────┬──┘
       │          │             │
   ┌───▼───┐  ┌──▼──────┐  ┌───▼──────┐
   │Ingest │  │Retrieval│  │Evaluation│
   │Phase  │  │Phase    │  │Phase     │
   └───┬───┘  └──┬──────┘  └───┬──────┘
       │         │             │
       └─────────┼─────────────┘
                 │
         ┌───────▼────────┐
         │  MCP Client    │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ Knowledge      │
         │ Graph Manager  │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │  Neo4j +       │
         │  OpenAI        │
         │  Embeddings    │
         └────────────────┘
```

## Contributing

To add new test scenarios:

1. Add facts to `src/benchmark/data/facts.json`
2. Add corresponding questions to `src/benchmark/data/questions.json`
3. Ensure total LLM calls per cycle stays under 250 for 4 cycles/day
4. Run the benchmark: `npm run benchmark`

## License

MIT - See main project LICENSE file
