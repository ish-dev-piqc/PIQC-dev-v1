// =============================================================================
// Demo Mode — public surface.
//
// Consumers import from `src/lib/demo` (this file). The store + fixture
// helpers + ask-response lookup are exported; internal IDs and date helpers
// stay module-private to keep the demo namespace small.
// =============================================================================

export { getDemoStore, createDemoStore, type DemoState, type DemoStore } from './store';
export {
  DEMO_ASK_RESPONSES,
  DEMO_FALLBACK_ASK_RESPONSE,
  type DemoAskResponse,
} from './fixtures/askResponses';
export { DEMO_DOCS_BY_PROTOCOL } from './fixtures/documents';
export { DEMO_PROTOCOL_IDS, DEMO_PARTICIPANT_UUIDS } from './ids';
