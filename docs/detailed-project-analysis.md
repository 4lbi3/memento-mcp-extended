# Memento MCP: Comprehensive Technical Analysis

## Project Overview

Memento MCP is a sophisticated knowledge graph memory system designed for Large Language Models (LLMs) that implements the Model Context Protocol (MCP). It provides persistent, semantic memory capabilities through a Neo4j-backed knowledge graph with advanced features like temporal awareness, confidence decay, and vector-based semantic search.

## Core Architecture

### Entry Point and Initialization (`src/index.ts`)

The main entry point serves as the central orchestrator for the entire system:

#### Key Responsibilities:
1. **Storage Provider Initialization**: Creates and configures the Neo4j storage provider using environment-based configuration
2. **Embedding Service Setup**: Initializes OpenAI-based embedding generation with rate limiting and caching
3. **Knowledge Graph Manager Creation**: Instantiates the core `KnowledgeGraphManager` with all necessary dependencies
4. **MCP Server Setup**: Configures and starts the Model Context Protocol server
5. **Background Processing**: Sets up periodic embedding job processing (every 10 seconds)

#### Critical Configuration Logic:
```typescript
// Environment variable validation for OpenAI API key
if (!process.env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY environment variable is not set. Semantic search will use random embeddings.');
}

// Rate limiting configuration for embedding API calls
const rateLimiterOptions = {
  tokensPerInterval: process.env.EMBEDDING_RATE_LIMIT_TOKENS ? parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS, 10) : 20,
  interval: process.env.EMBEDDING_RATE_LIMIT_INTERVAL ? parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL, 10) : 60 * 1000,
};
```

#### Adapter Pattern Implementation:
The system uses an adapter pattern to bridge different storage provider interfaces:

```typescript
const adaptedStorageProvider = {
  ...storageProvider,
  // Compatibility layer for embedding operations
  storeEntityVector: async (name: string, embedding: any) => {
    // Format conversion and error handling
    const formattedEmbedding = {
      vector: embedding.vector || embedding,
      model: embedding.model || 'unknown',
      lastUpdated: embedding.lastUpdated || Date.now(),
    };
    // Delegate to Neo4j storage provider
    return await storageProvider.updateEntityEmbedding(name, formattedEmbedding);
  }
};
```

### Knowledge Graph Manager (`src/KnowledgeGraphManager.ts`)

This is the core business logic component that orchestrates all knowledge graph operations.

#### Key Components:

**1. Storage Provider Abstraction:**
```typescript
interface KnowledgeGraphManagerOptions {
  storageProvider?: StorageProvider;
  memoryFilePath?: string;
  embeddingJobManager?: EmbeddingJobManager;
  vectorStoreOptions?: VectorStoreFactoryOptions;
}
```

**2. Entity Management:**
- **createEntities()**: Handles batch entity creation with deduplication and embedding scheduling
- **deleteEntities()**: Removes entities and associated relations with vector store cleanup
- **addObservations()**: Appends observations to existing entities with automatic re-embedding

**3. Relation Management:**
- **createRelations()**: Creates directed relationships between entities with validation
- **updateRelation()**: Modifies existing relations with temporal versioning
- **deleteRelations()**: Removes relations from the graph

**4. Search Operations:**
- **searchNodes()**: Basic text-based entity and relation search
- **openNodes()**: Retrieves specific entities by name with related relations
- **search()**: Advanced search with semantic, hybrid, and keyword options

**5. Temporal Features:**
- **getEntityHistory()**: Retrieves complete version history for entities
- **getRelationHistory()**: Retrieves complete version history for relations
- **getGraphAtTime()**: Point-in-time graph state retrieval
- **getDecayedGraph()**: Confidence-decayed graph based on temporal decay algorithms

#### Vector Store Integration:
```typescript
private async ensureVectorStore(): Promise<VectorStore> {
  if (!this.vectorStore) {
    const vectorStore = await VectorStoreFactory.createVectorStore(this.storageProvider.vectorStoreOptions);
    // Initialize with existing entity embeddings
    await this.initializeVectorStoreWithExistingEntities(vectorStore);
    return vectorStore;
  }
  return this.vectorStore;
}
```

### Storage Architecture

#### Neo4j Storage Provider (`src/storage/neo4j/Neo4jStorageProvider.ts`)

**Core Responsibilities:**
1. **Connection Management**: Handles Neo4j driver connections and transactions
2. **Schema Management**: Creates and maintains database constraints and indexes
3. **CRUD Operations**: Implements all basic entity and relation operations
4. **Vector Operations**: Manages embedding storage and similarity search
5. **Temporal Operations**: Handles version history and time-based queries

**Key Configuration:**
```typescript
interface Neo4jStorageProviderOptions {
  config?: Partial<Neo4jConfig>;
  connectionManager?: Neo4jConnectionManager;
  decayConfig?: {
    enabled: boolean;
    halfLifeDays?: number;  // Default: 30 days
    minConfidence?: number; // Default: 0.1
  };
}
```

#### Schema Management (`src/storage/neo4j/Neo4jSchemaManager.ts`)

**Database Structure:**
```cypher
// Entity nodes with temporal metadata
CREATE CONSTRAINT entity_name IF NOT EXISTS
FOR (e:Entity)
REQUIRE (e.name, e.validTo) IS UNIQUE

// Vector index for semantic search
CREATE VECTOR INDEX entity_embeddings IF NOT EXISTS
FOR (n:Entity)
ON (n.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }
}
```

**Index Management:**
- **Uniqueness Constraints**: Ensures entity name uniqueness with temporal validity
- **Vector Indexes**: Optimized for high-dimensional vector similarity search
- **Composite Indexes**: Performance optimization for common query patterns

### Embedding System

#### OpenAI Embedding Service (`src/embeddings/OpenAIEmbeddingService.ts`)

**API Integration:**
```typescript
interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
```

**Key Features:**
1. **Batch Processing**: Handles multiple texts in single API calls
2. **Rate Limiting**: Prevents API quota exhaustion
3. **Error Handling**: Comprehensive error handling for API failures
4. **Vector Normalization**: Ensures consistent embedding quality

**Rate Limiting Implementation:**
```typescript
// Token bucket algorithm for API call management
private tokens: number;
private lastRefill: number;
private tokensPerInterval: number;
private interval: number;
```

#### Embedding Job Manager (`src/embeddings/EmbeddingJobManager.ts`)

**Job Processing Architecture:**
```sql
CREATE TABLE embedding_jobs (
  id TEXT PRIMARY KEY,
  entity_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3
);
```

**Processing Logic:**
1. **Priority Queue**: Higher priority jobs processed first
2. **Retry Mechanism**: Failed jobs automatically retried up to 3 times
3. **Caching**: LRU cache prevents redundant API calls
4. **Background Processing**: Non-blocking job execution

### Model Context Protocol Implementation

#### Server Setup (`src/server/setup.ts`)

**MCP Server Configuration:**
```typescript
const server = new Server({
  name: 'memento-mcp',
  version: '1.0.0',
  description: 'Memento MCP: Your persistent knowledge graph memory system',
  publisher: 'gannonh',
}, {
  capabilities: {
    tools: {},
    serverInfo: {},
    notifications: {},
    logging: {},
  }
});
```

#### Tool Registration:
```typescript
server.setRequestHandler(ListToolsRequestSchema, handleListToolsRequest);
server.setRequestHandler(CallToolRequestSchema, handleCallToolRequest);
```

#### Available MCP Tools

**Entity Management:**
- `create_entities`: Batch entity creation with observations
- `add_observations`: Append observations to existing entities
- `delete_entities`: Remove entities and associated relations
- `delete_observations`: Remove specific observations from entities

**Relation Management:**
- `create_relations`: Create directed relationships with metadata
- `get_relation`: Retrieve specific relation details
- `update_relation`: Modify existing relations
- `delete_relations`: Remove relations from graph

**Graph Operations:**
- `read_graph`: Retrieve entire knowledge graph
- `search_nodes`: Basic text-based search
- `open_nodes`: Retrieve specific entities by name

**Semantic Search:**
- `semantic_search`: Vector-based similarity search with configurable parameters
- `get_entity_embedding`: Retrieve embedding vectors for entities

**Temporal Features:**
- `get_entity_history`: Complete entity version history
- `get_relation_history`: Complete relation version history
- `get_graph_at_time`: Point-in-time graph snapshots
- `get_decayed_graph`: Confidence-decayed graph view

**Debug Tools (when DEBUG=true):**
- `force_generate_embedding`: Manually trigger embedding generation
- `debug_embedding_config`: Diagnostic information
- `diagnose_vector_search`: Vector index diagnostics

### Data Model Architecture

#### Entity Structure
```typescript
interface Entity {
  name: string;           // Unique identifier
  entityType: string;     // Classification (person, organization, event, etc.)
  observations: string[]; // Array of textual observations
  embedding?: EntityEmbedding; // Optional vector representation
}

interface TemporalEntity extends Entity {
  id?: string;           // UUID for temporal tracking
  createdAt: number;     // Creation timestamp
  updatedAt: number;     // Last modification timestamp
  validFrom?: number;    // Validity start time
  validTo?: number;      // Validity end time (null for current)
  version: number;       // Version counter
  changedBy?: string;    // Modification source
}
```

#### Relation Structure
```typescript
interface Relation {
  from: string;          // Source entity name
  to: string;            // Target entity name
  relationType: string;  // Relationship type (works_at, located_in, etc.)
  strength?: number;     // 0.0-1.0 relationship strength
  confidence?: number;   // 0.0-1.0 confidence score
  metadata?: RelationMetadata; // Additional context
}

interface TemporalRelation extends Relation {
  id?: string;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
  validFrom?: number;
  validTo?: number;
  changedBy?: string;
}
```

#### Embedding Structure
```typescript
interface EntityEmbedding {
  vector: number[];      // High-dimensional vector (1536 dimensions for text-embedding-3-small)
  model: string;         // Embedding model used (e.g., "text-embedding-3-small")
  lastUpdated: number;   // Timestamp of last embedding update
}
```

### Temporal Awareness System

#### Version History Tracking:
Every entity and relation maintains complete version history:

```cypher
// Neo4j temporal node structure
(e:Entity {
  name: "John_Doe",
  entityType: "person",
  observations: ["Software Engineer at Acme Corp"],
  embedding: [...],     // 1536-dimensional vector
  id: "uuid-123",
  version: 3,
  createdAt: 1703123456789,
  updatedAt: 1704123456789,
  validFrom: 1703123456789,
  validTo: null,        // null indicates current version
  changedBy: "user_input"
})
```

#### Confidence Decay Mechanism:
Relations automatically decay in confidence over time:

```typescript
// Exponential decay calculation
const decayFactor = Math.pow(0.5, ageInDays / halfLifeDays);
const decayedConfidence = Math.max(
  originalConfidence * decayFactor,
  minConfidenceFloor
);
```

**Decay Parameters:**
- **Half-life**: 30 days (configurable)
- **Minimum confidence floor**: 0.1 (configurable)
- **Decay function**: Exponential decay with configurable half-life

### Semantic Search Implementation

#### Hybrid Search Algorithm:
```typescript
async search(query: string, options: SearchOptions): Promise<KnowledgeGraph> {
  // Determine search strategy based on available capabilities
  if (options.semanticSearch || options.hybridSearch) {
    if (this.storageProvider.semanticSearch) {
      // Use provider's semantic search
      return this.storageProvider.semanticSearch(query, options);
    } else if (this.embeddingJobManager) {
      // Fallback to internal semantic search
      return this.semanticSearch(query, options);
    }
  }

  // Fallback to basic text search
  return this.searchNodes(query);
}
```

#### Vector Similarity Search:
```cypher
// Neo4j vector search query
CALL db.index.vector.queryNodes('entity_embeddings', 10, $queryVector)
YIELD node, score
WHERE score > $minSimilarity
RETURN node.name as name, score
ORDER BY score DESC
```

#### Search Strategy Selection:
1. **Vector-only**: Pure semantic similarity (when embeddings available)
2. **Keyword-only**: Text-based matching (fallback)
3. **Hybrid**: Weighted combination of semantic and keyword results

### Configuration System

#### Environment Variables:
```bash
# Neo4j Connection
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=memento_password
NEO4J_DATABASE=neo4j

# Vector Search Configuration
NEO4J_VECTOR_INDEX=entity_embeddings
NEO4J_VECTOR_DIMENSIONS=1536
NEO4J_SIMILARITY_FUNCTION=cosine

# Embedding Service
OPENAI_API_KEY=your-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# System Configuration
MEMORY_STORAGE_TYPE=neo4j
DEBUG=true
EMBEDDING_RATE_LIMIT_TOKENS=20
EMBEDDING_RATE_LIMIT_INTERVAL=60000
```

#### Docker Configuration:
```yaml
services:
  neo4j:
    image: neo4j:2025.03.0-enterprise
    environment:
      - NEO4J_AUTH=neo4j/memento_password
      - NEO4J_ACCEPT_LICENSE_AGREEMENT=yes
    ports:
      - "17474:7474"  # HTTP
      - "17687:7687"  # Bolt
    volumes:
      - ./neo4j-data:/data
      - ./neo4j-logs:/logs
      - ./neo4j-import:/import
```

### Error Handling and Logging

#### Logger Implementation (`src/utils/logger.ts`):
```typescript
interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}
```

#### Error Propagation:
- **Graceful Degradation**: System continues operating when non-critical components fail
- **Detailed Error Context**: All errors include relevant metadata for debugging
- **Recovery Mechanisms**: Automatic retry for transient failures (embedding API calls)

### CLI Tools (`src/cli/neo4j-setup.ts`)

#### Available Commands:
```bash
# Test Neo4j connection
npm run neo4j:test

# Initialize database schema
npm run neo4j:init

# Initialize with custom parameters
npm run neo4j:init -- --dimensions 768 --similarity euclidean
```

#### Command Line Options:
```typescript
interface CliOptions {
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
  vectorIndex?: string;
  dimensions?: number;
  similarity?: 'cosine' | 'euclidean';
  recreate?: boolean;
  debug?: boolean;
}
```

### Testing Architecture

#### Test Structure:
```
src/
├── **/__vitest__/
│   ├── storage.test.ts
│   ├── knowledge-graph-manager.test.ts
│   ├── embedding-service.test.ts
│   └── ...
```

#### Test Configuration (`vitest.config.ts`):
```typescript
export default defineConfig({
  test: {
    include: ['**/__vitest__/**/*.test.{js,ts}'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        branches: 50,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
  },
});
```

### Build and Development Process

#### Build Process (`package.json`):
```json
{
  "scripts": {
    "build": "tsc && shx chmod +x dist/*.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "lint": "eslint 'src/**/*.ts'",
    "format": "prettier --write '**/*.{ts,json,md}'"
  }
}
```

#### TypeScript Configuration (`tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/node_modules/**", "**/dist/**"]
}
```

### Integration Points

#### Claude Desktop Integration:
```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "@gannonh/memento-mcp"],
      "env": {
        "MEMORY_STORAGE_TYPE": "neo4j",
        "NEO4J_URI": "bolt://127.0.0.1:7687",
        "NEO4J_USERNAME": "neo4j",
        "NEO4J_PASSWORD": "memento_password",
        "OPENAI_API_KEY": "your-openai-api-key",
        "DEBUG": "true"
      }
    }
  }
}
```

#### Performance Characteristics

#### Scalability Features:
1. **Vector Indexing**: Neo4j's native vector indexes for sub-second similarity search
2. **Connection Pooling**: Efficient Neo4j driver connection management
3. **Caching**: LRU cache for embedding vectors and frequent queries
4. **Background Processing**: Non-blocking embedding generation

#### Memory Management:
- **LRU Caching**: Prevents memory leaks with bounded cache sizes
- **Batch Processing**: Efficient bulk operations for entities and relations
- **Lazy Loading**: Components initialized only when needed

### Security Considerations

#### API Key Management:
- Environment variable based configuration
- No hardcoded credentials in source code
- Graceful degradation when API keys unavailable

#### Database Security:
- Neo4j enterprise authentication
- Container user mapping for file permissions
- Volume-based data persistence

### Monitoring and Diagnostics

#### Debug Tools:
- `diagnose_vector_search`: Vector index health checking
- `debug_embedding_config`: Configuration validation
- `force_generate_embedding`: Manual embedding regeneration

#### Logging Levels:
- **DEBUG**: Detailed operation tracing
- **INFO**: Normal operation events
- **WARN**: Non-critical issues
- **ERROR**: Critical failures requiring attention

## Detailed MCP Tool Implementation

### Tool Handler Architecture

The MCP tool handlers follow a consistent pattern with comprehensive error handling:

#### Core Handler Pattern:
```typescript
export async function handleToolName(
  args: Record<string, unknown>,
  knowledgeGraphManager: any
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Input validation
  // Business logic execution
  // Result formatting
  // Error handling
}
```

#### Error Handling Strategy:
- **Graceful Degradation**: Tools continue operating when non-critical errors occur
- **Detailed Error Messages**: All errors include context for debugging
- **Consistent Response Format**: All responses follow JSON structure
- **Logging**: Errors are logged to stderr for monitoring

### Tool-Specific Implementations

#### Entity Management Tools:
- **`create_entities`**: Batch creation with embedding scheduling
- **`add_observations`**: Observation appending with automatic re-embedding
- **`delete_entities`**: Cascading deletion of entities and relations
- **`delete_observations`**: Selective observation removal

#### Relation Management Tools:
- **`create_relations`**: Relation creation with validation and metadata
- **`get_relation`**: Relation retrieval by triple (from, to, relationType)
- **`update_relation`**: Relation modification with temporal versioning
- **`delete_relations`**: Relation removal with graph consistency

#### Search and Retrieval Tools:
- **`search_nodes`**: Text-based entity/relation search
- **`open_nodes`**: Direct entity retrieval by name
- **`semantic_search`**: Vector similarity search with hybrid options
- **`get_entity_embedding`**: Direct embedding vector access

#### Temporal Features:
- **`get_entity_history`**: Complete entity version timeline
- **`get_relation_history`**: Complete relation version timeline
- **`get_graph_at_time`**: Point-in-time graph snapshots
- **`get_decayed_graph`**: Confidence-decayed graph view

### Debug and Diagnostic Tools

#### Configuration Diagnostics:
```typescript
case 'debug_embedding_config':
  // Comprehensive system status check
  const diagnosticInfo = {
    storage_type: process.env.MEMORY_STORAGE_TYPE || 'neo4j',
    openai_api_key_present: !!process.env.OPENAI_API_KEY,
    embedding_model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embedding_job_manager_initialized: !!knowledgeGraphManager.embeddingJobManager,
    neo4j_config: { /* detailed Neo4j config */ },
    entities_with_embeddings: entitiesWithEmbeddings,
    pending_embedding_jobs: pendingJobs
  };
```

#### Vector Search Diagnostics:
```typescript
case 'diagnose_vector_search':
  // Direct Neo4j vector index inspection
  return await storageProvider.diagnoseVectorSearch();
```

#### Manual Embedding Generation:
```typescript
case 'force_generate_embedding':
  // Multi-stage entity lookup (name, ID, direct database)
  // Text preparation and embedding generation
  // Dual storage (name and ID indexing)
```

## CLI Tools Deep Analysis

### Neo4j Setup CLI (`src/cli/neo4j-setup.ts`)

#### Command Architecture:
```typescript
// Factory pattern for testability
const connectionManagerFactory = (config) => new Neo4jConnectionManager(config);
const schemaManagerFactory = (connectionManager, debug) =>
  new Neo4jSchemaManager(connectionManager, undefined, debug);
```

#### Connection Testing:
```typescript
export async function testConnection(config, debug, connectionManagerFactory) {
  const connectionManager = connectionManagerFactory(config);
  try {
    const session = await connectionManager.getSession();
    const result = await session.run('RETURN 1 as value');
    return result.records[0].get('value').toNumber() === 1;
  } finally {
    await connectionManager.close();
  }
}
```

#### Schema Initialization:
```typescript
export async function initializeSchema(config, debug, recreate) {
  // Test connection first
  const connected = await testConnection(config, debug);

  if (connected) {
    // Create entity constraints
    await schemaManager.createEntityConstraints(recreate);

    // Create vector index
    await schemaManager.createVectorIndex(
      config.vectorIndexName,
      'Entity',
      'embedding',
      config.vectorDimensions,
      config.similarityFunction,
      recreate
    );
  }
}
```

#### Argument Parsing:
```typescript
export function parseArgs(argv: string[]): { config: Neo4jConfig; options: { debug: boolean; recreate: boolean } } {
  const config = { ...DEFAULT_NEO4J_CONFIG };
  const options = { debug: true, recreate: false };

  // Parse command-line flags
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--uri': config.uri = argv[++i]; break;
      case '--username': config.username = argv[++i]; break;
      case '--password': config.password = argv[++i]; break;
      case '--dimensions': config.vectorDimensions = parseInt(argv[++i], 10); break;
      // ... additional parsing
    }
  }
}
```

## Utility Functions

### Logger Implementation (`src/utils/logger.ts`)

#### MCP-Compatible Logging:
```typescript
export const logger = {
  info: (message: string, ...args: any[]) => {
    process.stderr.write(`[INFO] ${message}\n`);
    if (args.length > 0) {
      process.stderr.write(`${JSON.stringify(args, null, 2)}\n`);
    }
  },

  error: (message: string, error?: any) => {
    process.stderr.write(`[ERROR] ${message}\n`);
    if (error) {
      process.stderr.write(
        `${error instanceof Error ? error.stack : JSON.stringify(error, null, 2)}\n`
      );
    }
  },

  debug: (message: string, ...args: any[]) => {
    process.stderr.write(`[DEBUG] ${message}\n`);
    if (args.length > 0) {
      process.stderr.write(`${JSON.stringify(args, null, 2)}\n`);
    }
  },

  warn: (message: string, ...args: any[]) => {
    process.stderr.write(`[WARN] ${message}\n`);
    if (args.length > 0) {
      process.stderr.write(`${JSON.stringify(args, null, 2)}\n`);
    }
  },
};
```

**Key Design Decisions:**
- **Stderr Output**: Avoids interfering with MCP stdio communication
- **JSON Formatting**: Structured data for programmatic processing
- **Stack Traces**: Full error context for debugging
- **Conditional Logging**: Debug logs only when needed

### File System Utilities (`src/utils/fs.ts`)

#### Simple Promise-based Wrapper:
```typescript
import { promises as fs } from 'fs';
export { fs };
```

This provides a clean interface for file operations while maintaining Node.js promises API.

## Environment Variable Reference

### Complete Environment Configuration:

```bash
# Neo4j Database Configuration
NEO4J_URI=bolt://127.0.0.1:7687              # Neo4j server URI
NEO4J_USERNAME=neo4j                         # Database username
NEO4J_PASSWORD=memento_password              # Database password
NEO4J_DATABASE=neo4j                         # Database name

# Vector Search Configuration
NEO4J_VECTOR_INDEX=entity_embeddings         # Vector index name
NEO4J_VECTOR_DIMENSIONS=1536                 # Embedding dimensions
NEO4J_SIMILARITY_FUNCTION=cosine             # Similarity metric

# OpenAI Embedding Service
OPENAI_API_KEY=your-api-key                  # Required for embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-small # Model selection

# System Configuration
MEMORY_STORAGE_TYPE=neo4j                    # Storage backend type
DEBUG=true                                   # Enable debug logging

# Rate Limiting (Optional)
EMBEDDING_RATE_LIMIT_TOKENS=20              # Requests per interval
EMBEDDING_RATE_LIMIT_INTERVAL=60000         # Interval in ms

# Docker Port Mapping (Optional)
NEO4J_HTTP_HOST_PORT=17474                  # Host HTTP port
NEO4J_HTTP_CONTAINER_PORT=7474              # Container HTTP port
NEO4J_BOLT_HOST_PORT=17687                  # Host Bolt port
NEO4J_BOLT_CONTAINER_PORT=7687              # Container Bolt port
```

### Environment Variable Processing:

#### Validation Logic:
```typescript
// OpenAI API key validation
if (!process.env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY environment variable is not set. Semantic search will use random embeddings.');
}

// Rate limiting configuration with defaults
const rateLimiterOptions = {
  tokensPerInterval: process.env.EMBEDDING_RATE_LIMIT_TOKENS
    ? parseInt(process.env.EMBEDDING_RATE_LIMIT_TOKENS, 10)
    : 20,
  interval: process.env.EMBEDDING_RATE_LIMIT_INTERVAL
    ? parseInt(process.env.EMBEDDING_RATE_LIMIT_INTERVAL, 10)
    : 60 * 1000,
};
```

## Error Handling Patterns

### Multi-Level Error Handling:

#### 1. Tool Handler Level:
```typescript
try {
  const result = await knowledgeGraphManager.operation(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
} catch (error: Error | unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
  };
}
```

#### 2. Storage Provider Level:
```typescript
try {
  await this.connectionManager.executeQuery(cypherQuery, parameters);
} catch (neo4jError) {
  logger.error('Neo4j query failed', neo4jError);
  throw new Error(`Database operation failed: ${neo4jError.message}`);
}
```

#### 3. Service Level (Embeddings):
```typescript
try {
  const response = await axios.post<OpenAIEmbeddingResponse>(endpoint, payload, config);
  return response.data.data[0].embedding;
} catch (axiosError) {
  if (axiosError.isAxiosError) {
    if (axiosError.response?.status === 401) {
      throw new Error('OpenAI API authentication failed - invalid API key');
    }
    if (axiosError.response?.status === 429) {
      throw new Error('OpenAI API rate limit exceeded - try again later');
    }
  }
  throw new Error(`Embedding generation failed: ${axiosError.message}`);
}
```

### Error Recovery Strategies:

#### 1. Graceful Degradation:
- When OpenAI API unavailable → Use random embeddings for testing
- When vector store unavailable → Fall back to text search
- When temporal features unavailable → Continue with basic operations

#### 2. Retry Mechanisms:
- Embedding job failures → Automatic retry up to 3 times
- Network timeouts → Exponential backoff retry
- Database connection issues → Connection pool recovery

#### 3. Logging Hierarchy:
- **DEBUG**: Detailed operation tracing for development
- **INFO**: Normal operation events and milestones
- **WARN**: Non-critical issues that don't stop operation
- **ERROR**: Critical failures requiring attention

## Testing Architecture

### Test Organization (`src/__vitest__/`):

#### Unit Test Structure:
```typescript
describe('KnowledgeGraphManager with StorageProvider', () => {
  it('should accept a StorageProvider in constructor', () => {
    const mockProvider: Partial<StorageProvider> = {
      loadGraph: vi.fn(),
      saveGraph: vi.fn(),
      // ... other required methods
    };

    const manager = new KnowledgeGraphManager({ storageProvider: mockProvider as StorageProvider });
    expect(manager).toBeInstanceOf(KnowledgeGraphManager);
  });
});
```

#### Mock Strategy:
```typescript
const mockProvider: Partial<StorageProvider> = {
  loadGraph: vi.fn().mockResolvedValue(mockGraph),
  saveGraph: vi.fn().mockResolvedValue(undefined),
  searchNodes: vi.fn().mockResolvedValue(searchResults),
  // Comprehensive mocking of all interface methods
};
```

#### Test Coverage Goals:
- **Branches**: 50% minimum
- **Functions**: 50% minimum
- **Lines**: 50% minimum
- **Statements**: 50% minimum

### Integration Testing:

#### Test Commands:
```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:integration": "TEST_INTEGRATION=true npm test"
}
```

#### Environment-Specific Testing:
```typescript
// Integration tests only run when TEST_INTEGRATION=true
if (process.env.TEST_INTEGRATION) {
  describe('Integration Tests', () => {
    // Tests that require actual Neo4j/OpenAI connections
  });
}
```

## Docker Configuration Analysis

### Docker Compose Structure:

```yaml
services:
  neo4j:
    image: neo4j:2025.03.0-enterprise
    user: "${UID:-1000}:${GID:-1000}"          # Permission mapping
    environment:
      - NEO4J_AUTH=neo4j/memento_password       # Authentication
      - NEO4J_ACCEPT_LICENSE_AGREEMENT=yes     # License acceptance
      - NEO4J_apoc_export_file_enabled=true    # APOC procedures
      - NEO4J_apoc_import_file_enabled=true
      - NEO4J_apoc_import_file_use__neo4j__config=true
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*
      - NEO4J_dbms_security_procedures_allowlist=apoc.*,gds.*
      - NEO4J_server_memory_pagecache_size=768M   # Memory tuning
      - NEO4J_server_memory_heap_max__size=1536M
    ports:
      - "${NEO4J_HTTP_HOST_PORT:-17474}:${NEO4J_HTTP_CONTAINER_PORT:-7474}"
      - "${NEO4J_BOLT_HOST_PORT:-17687}:${NEO4J_BOLT_CONTAINER_PORT:-7687}"
    volumes:
      - ./neo4j-data:/data          # Persistent data
      - ./neo4j-logs:/logs          # Log persistence
      - ./neo4j-import:/import       # Import directory
```

### Volume Management:
- **Data Persistence**: `/data` directory survives container restarts
- **Log Retention**: `/logs` for troubleshooting and monitoring
- **Import Capability**: `/import` for bulk data loading

### Security Configuration:
- **Enterprise Edition**: Advanced security features
- **APOC Procedures**: Graph algorithms and utilities
- **GDS Library**: Graph Data Science algorithms
- **Procedure Restrictions**: Controlled access to sensitive operations

## Conclusion

Memento MCP represents a sophisticated implementation of persistent memory for LLMs, combining graph database technology with modern vector search capabilities. The system's modular architecture allows for easy extension and maintenance, while its comprehensive feature set provides robust semantic memory capabilities for AI applications.

The integration of temporal awareness, confidence decay, and hybrid search algorithms creates a memory system that not only stores information but also manages its relevance and accuracy over time. The use of Neo4j as the storage backend provides excellent performance characteristics for both graph traversals and vector operations, making it suitable for production deployments with large knowledge graphs.

### Key Architectural Strengths:

1. **Modular Design**: Clean separation of concerns between storage, embedding, and MCP layers
2. **Error Resilience**: Comprehensive error handling with graceful degradation
3. **Performance Optimization**: Caching, rate limiting, and background processing
4. **Developer Experience**: Extensive logging, debugging tools, and testing infrastructure
5. **Production Ready**: Docker deployment, environment configuration, and monitoring capabilities

The codebase demonstrates enterprise-grade software engineering practices with thorough testing, documentation, and operational considerations, making it a robust foundation for LLM memory systems.

## Appendix: Analysis Completion Summary

This comprehensive technical analysis was completed through systematic exploration of the Memento MCP codebase. The following components were analyzed in detail:

### ✅ **Completed Analysis Tasks:**

1. **Project Structure Exploration** - Mapped all source files, configuration files, and directory organization
2. **Package Configuration** - Analyzed dependencies, scripts, and build processes
3. **TypeScript Configuration** - Reviewed compilation settings, testing framework, and code quality tools
4. **MCP Server Initialization** - Traced application startup sequence and component wiring
5. **Storage Architecture** - Deep dive into Neo4j integration, schema management, and vector operations
6. **Embedding Systems** - Analysis of OpenAI and fallback embedding services with job management
7. **Knowledge Graph Operations** - Complete review of entity/relation CRUD operations
8. **MCP Tool Implementation** - Detailed examination of all 15+ MCP tools and their handlers
9. **Temporal Features** - Analysis of version history, confidence decay, and time-based operations
10. **Semantic Search** - Vector similarity, hybrid search algorithms, and fallback mechanisms
11. **CLI Tools** - Neo4j setup utilities and command-line management interfaces
12. **Testing Framework** - Vitest configuration, mocking strategies, and coverage goals
13. **Error Handling** - Multi-level error recovery, graceful degradation, and logging patterns
14. **Configuration Management** - Environment variables, Docker setup, and operational deployment
15. **Data Model Documentation** - Entity/relation structures, temporal extensions, and type definitions

### **Key Findings:**

- **Enterprise Architecture**: The system implements sophisticated patterns including dependency injection, factory methods, and adapter patterns
- **Robust Error Handling**: Multi-layer error recovery with graceful degradation and comprehensive logging
- **Performance Optimization**: Caching, background processing, and rate limiting for API operations
- **Production Readiness**: Docker deployment, environment configuration, and monitoring capabilities
- **Developer Experience**: Extensive testing, debugging tools, and clear architectural separation

### **Architecture Strengths:**

1. **Modular Design** - Clean separation between MCP protocol, storage, embedding, and business logic layers
2. **Scalability** - Neo4j backend supports large knowledge graphs with efficient vector operations
3. **Reliability** - Comprehensive error handling, retry mechanisms, and fallback strategies
4. **Maintainability** - Well-documented interfaces, consistent patterns, and thorough test coverage
5. **Extensibility** - Plugin architecture for embedding services and factory patterns for components

This analysis provides a complete technical foundation for understanding, maintaining, and extending the Memento MCP knowledge graph memory system.
