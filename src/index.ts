/**
 * duet-kit - Shared state for humans and LLMs
 *
 * A lightweight library for building UIs where both humans and AI
 * can edit the same validated state through a shared schema.
 *
 * Built on Zustand (state) + Zod (validation) + JSON Patch (RFC 6902).
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { createDuet, field, z } from 'duet-kit'
 *
 * const useTripStore = createDuet('TripBudget', {
 *   destination: field(z.string(), 'Destination', 'Tokyo'),
 *   budget: field(z.number().min(0).max(100000), 'Budget', 5000),
 * }, { persist: 'trip-data' })
 *
 * // React
 * const { data, set } = useTripStore()
 *
 * // LLM (JSON Patch format)
 * useTripStore.llm.applyJSON('[{"op":"replace","path":"/budget","value":10000}]')
 * ```
 */

// Main API
export { createDuet, field, isSuccess, getResultMessage, type DuetHook, type DuetOptions } from './duet';

// Drop-in for existing Zustand + Zod codebases
export { attachLLM } from './attach';

// Types
export type {
  SchemaFields,
  FieldDef,
  InferData,
  JsonPatchOp,
  EditResult,
  HistoryEntry,
  LLMBridge,
} from './types';

// Re-export Zod for convenience
export { z } from 'zod';

// Advanced: individual building blocks (createDuet combines these)
export { createSchema, DuetSchema } from './schema';
export { createStore, type DuetStore, type StoreOptions } from './store';
export { createLLMBridge } from './llm';
