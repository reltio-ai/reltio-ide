## ADDED Requirements

### Requirement: AI chat panel opens via command
The extension SHALL register a command "Reltio: Ask AI" that opens a webview panel with a chat interface for AI-assisted configuration editing.

#### Scenario: Open AI chat
- **WHEN** the user runs "Reltio: Ask AI" from the command palette
- **THEN** a webview panel SHALL open with a chat input and message area

### Requirement: Pluggable LLM backend
The AI assistant SHALL support multiple LLM providers through a pluggable adapter interface. Supported providers SHALL include OpenAI, Anthropic, and Ollama (local).

#### Scenario: Configure OpenAI provider
- **WHEN** the user sets `reltio.ai.provider` to "openai" and provides an API key in `reltio.ai.apiKey`
- **THEN** the AI assistant SHALL use the OpenAI API for completions

#### Scenario: Configure Ollama for local inference
- **WHEN** the user sets `reltio.ai.provider` to "ollama" and Ollama is running locally
- **THEN** the AI assistant SHALL use the local Ollama instance with no API key required

#### Scenario: No provider configured
- **WHEN** the user opens the AI chat with no provider configured
- **THEN** the chat SHALL display a message guiding the user to configure a provider in settings

### Requirement: Schema-aware system prompt
The AI assistant SHALL include the Reltio metadata JSON schema and the current configuration file contents in the system prompt so the LLM generates schema-compliant responses.

#### Scenario: AI generates valid entity type
- **WHEN** the user asks "Add an entity type for Product with attributes Name, SKU, and Price"
- **THEN** the AI SHALL respond with a JSON object that conforms to the Reltio metadata schema, including proper URI format, required fields, and valid attribute types

### Requirement: Streaming responses
The AI assistant SHALL display LLM responses as they stream in, rendering markdown and JSON code blocks progressively.

#### Scenario: Streaming display
- **WHEN** the AI generates a response
- **THEN** text SHALL appear incrementally in the chat panel as tokens arrive from the LLM

### Requirement: Apply action on code blocks
JSON code blocks in AI responses SHALL include an "Apply" button that inserts or replaces the corresponding JSON in the active editor.

#### Scenario: Apply generated entity type
- **WHEN** the AI generates a JSON code block with a new entity type and the user clicks "Apply"
- **THEN** the entity type SHALL be inserted into the `entityTypes` array of the active `.reltio.json` file

#### Scenario: Apply with no active file
- **WHEN** the user clicks "Apply" but no `.reltio.json` file is open
- **THEN** the extension SHALL display a warning message

### Requirement: Chat preserves conversation history
The AI chat SHALL maintain conversation history within the session so the LLM has context from previous messages.

#### Scenario: Follow-up question uses context
- **WHEN** the user asks "Add a FirstName attribute to it" after previously asking about an Individual entity type
- **THEN** the AI SHALL understand "it" refers to the Individual entity type from the prior message

### Requirement: AI settings in VS Code configuration
The extension SHALL contribute settings for `reltio.ai.provider`, `reltio.ai.apiKey`, `reltio.ai.model`, and `reltio.ai.ollamaUrl` to VS Code's settings system.

#### Scenario: Settings appear in VS Code
- **WHEN** the user opens VS Code settings and searches for "reltio"
- **THEN** the AI-related settings SHALL appear with descriptions and default values
