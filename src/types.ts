/**
 * duet-kit - Core Types
 */

import { z } from 'zod';

// Field definition with Zod schema + metadata
export interface FieldDef<T = unknown> {
  schema: z.ZodType<T>;
  label: string;
  default: T;
}

// Schema definition
export type SchemaFields = Record<string, FieldDef>;

// Infer data type from schema fields
export type InferData<T extends SchemaFields> = {
  [K in keyof T]: z.infer<T[K]['schema']>;
};

// JSON Patch operation (RFC 6902)
export interface JsonPatchOp {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: unknown;
}

// Result of applying edits
export type EditResult =
  | { success: true; applied: number }
  | { success: false; error: string };

// History entry for audit trail
export interface HistoryEntry {
  id: string;
  timestamp: number;
  patch: JsonPatchOp[];
  source: 'user' | 'llm' | 'system';
  result: EditResult;
}

// Store state shape
export interface DuetState<T extends SchemaFields> {
  data: InferData<T>;
  set: <K extends keyof T>(field: K, value: z.infer<T[K]['schema']>) => boolean;
  setMany: (updates: Partial<InferData<T>>) => boolean;
  reset: () => void;
}

// LLM Bridge interface
export interface LLMBridge<T extends SchemaFields> {
  applyPatch: (patch: JsonPatchOp[], source?: 'user' | 'llm' | 'system') => EditResult;
  applyJSON: (json: string, source?: 'user' | 'llm' | 'system') => EditResult;
  getContext: () => string;
  getCompactContext: () => string;
  getFunctionSchema: () => object;
  getCurrentValues: () => InferData<T>;
  history: () => HistoryEntry[];
  clearHistory: () => void;
}
