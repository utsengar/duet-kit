/**
 * duet-kit - Main Entry Point
 * 
 * Single factory that creates everything: store + LLM bridge + schema access.
 * Follows Zustand conventions - returns a hook with static properties.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import type { SchemaFields, FieldDef, InferData, JsonPatchOp, EditResult, LLMBridge, HistoryEntry } from './types';
import { DuetSchema } from './schema';

// Store state shape
interface DuetState<T extends SchemaFields> {
  data: InferData<T>;
  set: <K extends keyof T>(field: K, value: z.infer<T[K]['schema']>) => boolean;
  setMany: (updates: Partial<InferData<T>>) => boolean;
  reset: () => void;
}

// The enhanced hook type with .llm and .schema
export interface DuetHook<T extends SchemaFields> extends UseBoundStore<StoreApi<DuetState<T>>> {
  llm: LLMBridge<T>;
  schema: DuetSchema<T>;
}

export interface DuetOptions {
  /** Optional localStorage key. Omit for in-memory only. For backend sync, use store.subscribe() */
  persist?: string;
  /** Transform the default context string before returning from getContext() */
  transformContext?: (context: string) => string;
  /** Transform the default function schema before returning from getFunctionSchema() */
  transformFunctionSchema?: (schema: object) => object;
}

/**
 * Create a Duet - a Zustand store with LLM bridge and schema access.
 * 
 * @example
 * ```typescript
 * const useTripStore = createDuet('TripBudget', {
 *   destination: field(z.string(), 'Destination', 'Tokyo'),
 *   budget: field(z.number().min(0), 'Budget', 5000),
 * }, { persist: 'trip-data' })
 * 
 * // React
 * const { data, set } = useTripStore()
 * 
 * // LLM (JSON Patch)
 * useTripStore.llm.applyJSON('[{"op":"replace","path":"/budget","value":10000}]')
 * ```
 */
export function createDuet<T extends SchemaFields>(
  name: string,
  fields: T,
  options: DuetOptions = {}
): DuetHook<T> {
  // Create schema
  const schema = new DuetSchema(name, fields);
  const initialData = schema.getDefaults();

  // Store creator function
  const storeCreator = (set: (fn: (state: DuetState<T>) => Partial<DuetState<T>>) => void): DuetState<T> => ({
    data: initialData,

    set: <K extends keyof T>(field: K, value: unknown): boolean => {
      const result = schema.validate(field, value);
      if (!result.success) {
        console.warn(`Validation failed for ${String(field)}:`, result.error.message);
        return false;
      }
      set((state) => ({
        data: { ...state.data, [field]: result.data },
      }));
      return true;
    },

    setMany: (updates: Partial<InferData<T>>): boolean => {
      const validated: Partial<InferData<T>> = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (key in schema.fields) {
          const result = schema.validate(key as keyof T, value);
          if (!result.success) {
            console.warn(`Validation failed for ${key}:`, result.error.message);
            return false;
          }
          (validated as Record<string, unknown>)[key] = result.data;
        }
      }
      
      set((state) => ({
        data: { ...state.data, ...validated },
      }));
      return true;
    },

    reset: () => {
      set(() => ({ data: schema.getDefaults() }));
    },
  });

  // Create the Zustand store
  const useStore = options.persist
    ? create<DuetState<T>>()(
        persist(storeCreator, {
          name: options.persist,
          partialize: (state) => ({ data: state.data }),
        })
      )
    : create<DuetState<T>>()(storeCreator);

  // History log for audit trail
  const patchHistory: HistoryEntry[] = [];
  let historyId = 0;

  // Create LLM bridge (JSON Patch format)
  const llmBridge: LLMBridge<T> = {
    applyPatch(patch: JsonPatchOp[], source: 'user' | 'llm' | 'system' = 'llm'): EditResult {
      const currentData = { ...useStore.getState().data } as Record<string, unknown>;
      
      for (const op of patch) {
        // Parse JSON Pointer path: /field or /parent/child
        const pathParts = op.path.replace(/^\//, '').split('/');
        const rootField = pathParts[0];
        
        if (!(rootField in schema.fields)) {
          const result: EditResult = { success: false, error: `Unknown field: ${rootField}` };
          patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
          return result;
        }
        
        if (op.op === 'remove') {
          if (pathParts.length === 1) {
            currentData[rootField] = schema.getDefaults()[rootField as keyof T];
          } else {
            let target = currentData[rootField] as Record<string, unknown>;
            for (let i = 1; i < pathParts.length - 1; i++) {
              target = target[pathParts[i]] as Record<string, unknown>;
            }
            delete target[pathParts[pathParts.length - 1]];
          }
          continue;
        }
        
        if (op.op === 'replace' || op.op === 'add') {
          if (pathParts.length === 1) {
            const result = schema.validate(rootField as keyof T, op.value);
            if (!result.success) {
              const editResult: EditResult = { 
                success: false, 
                error: `Invalid value for ${rootField}: ${result.error.errors[0]?.message}` 
              };
              patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result: editResult });
              return editResult;
            }
            currentData[rootField] = result.data;
          } else {
            const newValue = JSON.parse(JSON.stringify(currentData[rootField]));
            let target = newValue as Record<string, unknown>;
            for (let i = 1; i < pathParts.length - 1; i++) {
              if (!(pathParts[i] in target)) {
                target[pathParts[i]] = {};
              }
              target = target[pathParts[i]] as Record<string, unknown>;
            }
            target[pathParts[pathParts.length - 1]] = op.value;
            
            const result = schema.validate(rootField as keyof T, newValue);
            if (!result.success) {
              const editResult: EditResult = { 
                success: false, 
                error: `Invalid value for ${op.path}: ${result.error.errors[0]?.message}` 
              };
              patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result: editResult });
              return editResult;
            }
            currentData[rootField] = result.data;
          }
        }
      }
      
      const committed = useStore.getState().setMany(currentData as Partial<InferData<T>>);
      if (!committed) {
        const result: EditResult = { success: false, error: 'Failed to commit changes to store' };
        patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
        return result;
      }
      const result: EditResult = { success: true, applied: patch.length };
      patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
      return result;
    },

    applyJSON(json: string, source: 'user' | 'llm' | 'system' = 'llm'): EditResult {
      try {
        const parsed = JSON.parse(json);
        
        if (Array.isArray(parsed)) {
          return this.applyPatch(parsed as JsonPatchOp[], source);
        }
        
        if (parsed.patch && Array.isArray(parsed.patch)) {
          return this.applyPatch(parsed.patch as JsonPatchOp[], source);
        }
        
        return { success: false, error: 'Expected JSON Patch array or { patch: [...] } format' };
      } catch (e) {
        return { success: false, error: `JSON parse error: ${(e as Error).message}` };
      }
    },

    history(): HistoryEntry[] {
      return [...patchHistory];
    },

    clearHistory(): void {
      patchHistory.length = 0;
      historyId = 0;
    },

    getContext(): string {
      const data = useStore.getState().data;
      
      let context = schema.getDescription();
      context += '\nCurrent Values:\n';
      
      for (const [id, field] of Object.entries(schema.fields)) {
        const value = data[id as keyof typeof data];
        context += `  ${id}: ${JSON.stringify(value)} (${(field as FieldDef).label})\n`;
      }
      
      context += `
To edit fields, respond with a JSON Patch array (RFC 6902):
[{ "op": "replace", "path": "/fieldName", "value": newValue }]

Examples:
- Single edit: [{ "op": "replace", "path": "/budget", "value": 5000 }]
- Multiple: [{ "op": "replace", "path": "/budget", "value": 5000 }, { "op": "replace", "path": "/days", "value": 14 }]`;
      
      return options.transformContext ? options.transformContext(context) : context;
    },

    getCompactContext(): string {
      const data = useStore.getState().data;
      const values = Object.entries(data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      
      return `${schema.name}: {${values}}\nJSON Patch: [{"op":"replace","path":"/field","value":x}]`;
    },

    getFunctionSchema(): object {
      const fnSchema = {
        name: `patch_${schema.name.toLowerCase().replace(/\s+/g, '_')}`,
        description: `Apply JSON Patch operations to ${schema.name}. Uses RFC 6902 format.`,
        parameters: {
          type: 'object',
          properties: {
            patch: {
              type: 'array',
              description: 'JSON Patch operations (RFC 6902)',
              items: {
                type: 'object',
                properties: {
                  op: {
                    type: 'string',
                    enum: ['replace', 'add', 'remove'],
                    description: 'Operation type',
                  },
                  path: {
                    type: 'string',
                    description: `JSON Pointer to field. Valid paths: ${schema.getFieldIds().map(f => `/${f}`).join(', ')}`,
                  },
                  value: {
                    description: 'New value (required for replace/add)',
                  },
                },
                required: ['op', 'path'],
              },
            },
          },
          required: ['patch'],
        },
      };
      
      return options.transformFunctionSchema ? options.transformFunctionSchema(fnSchema) : fnSchema;
    },

    getCurrentValues(): InferData<T> {
      return useStore.getState().data;
    },
  };

  // Attach llm and schema to the hook
  const hook = useStore as DuetHook<T>;
  hook.llm = llmBridge;
  hook.schema = schema;

  return hook;
}

/**
 * Helper to define a field with Zod schema, label, and default value.
 */
export function field<T>(
  schema: z.ZodType<T>,
  label: string,
  defaultValue: T
): FieldDef<T> {
  return { schema, label, default: defaultValue };
}

/**
 * Helper to check if edit was successful
 */
export function isSuccess(result: EditResult): result is { success: true; applied: number } {
  return result.success;
}

/**
 * Get human-readable message from result
 */
export function getResultMessage(result: EditResult): string {
  if (result.success) {
    return `Successfully applied ${result.applied} operation(s)`;
  }
  return result.error;
}
