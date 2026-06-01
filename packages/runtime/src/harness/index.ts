/**
 * Harness module — the agent orchestration layer.
 *
 * Provides:
 *  - AgentHarness: core orchestration class
 *  - BackendRegistry: backend registration and lookup
 *  - PromptComposer: system prompt assembly
 *  - EventBridge: AgentEvent → Flock activity translation
 */

// Core harness
export {
  AgentHarness,
  type HarnessConfig,
  type SpawnRequest,
  type HarnessSession,
} from './agent-harness.js';

// Backend registry
export {
  BackendRegistry,
  defaultBackendRegistry,
} from './backend-registry.js';

// Prompt composer
export {
  composeSystemPrompt,
  type PromptParts,
  type ComposeOptions,
  type AgentIdentity,
  type RoomContext,
} from './prompt-composer.js';

// Event bridge
export {
  processEvent,
  createSessionState,
  type ActivityReporter,
  type SessionState,
} from './event-bridge.js';
