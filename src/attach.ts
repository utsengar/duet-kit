/**
 * duet-kit - Drop-in LLM Bridge
 * 
 * For users who already have Zustand and Zod in their codebase,
 * this allows adding LLM capabilities without rewriting anything.
 * Uses RFC 6902 JSON Patch format.
 */

import { z } from 'zod';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { JsonPatchOp, EditResult, LLMBridge, InferData, SchemaFields, HistoryEntry } from './types';

type ZodObjectSchema = z.ZodObject<z.ZodRawShape>;

interface AttachOptions {
  /** Name for the schema (used in LLM context) */
  name?: string;
  /** Human-readable labels for fields */
  labels?: Record<string, string>;
}

/**
 * Attach an LLM bridge to an existing Zustand store + Zod schema.
 * Uses RFC 6902 JSON Patch format for edits.
 * 
 * @example
 * ```typescript
 * // Your existing code (unchanged):
 * const todoSchema = z.object({
 *   title: z.string(),
 *   completed: z.boolean(),
 *   priority: z.number().min(1).max(5),
 * });
 * 
 * const useTodoStore = create<z.infer<typeof todoSchema>>()((set) => ({
 *   title: '',
 *   completed: false,
 *   priority: 1,
 * }));
 * 
 * // Drop-in addition (one line):
 * const todoLLM = attachLLM(useTodoStore, todoSchema);
 * 
 * // Now you have full LLM capabilities:
 * todoLLM.getContext()           // Generate context for prompts
 * todoLLM.applyJSON('...')       // Apply JSON Patch
 * todoLLM.getFunctionSchema()    // OpenAI function calling
 * ```
 */
export function attachLLM<T extends ZodObjectSchema>(
  store: UseBoundStore<StoreApi<z.infer<T>>>,
  schema: T,
  options: AttachOptions = {}
): LLMBridge<SchemaFields> {
  const name = options.name || 'State';
  const labels = options.labels || {};
  const shape = schema.shape;
  const fieldIds = Object.keys(shape);

  // Validate a single field value
  const validateField = (field: string, value: unknown): { success: true; data: unknown } | { success: false; error: string } => {
    const fieldSchema = shape[field];
    if (!fieldSchema) {
      return { success: false, error: `Unknown field: ${field}` };
    }
    const result = fieldSchema.safeParse(value);
    if (!result.success) {
      return { success: false, error: result.error.errors[0]?.message || 'Invalid value' };
    }
    return { success: true, data: result.data };
  };

  // Get field description from Zod schema
  const getFieldDescription = (fieldId: string): string => {
    const fieldSchema = shape[fieldId];
    const parts: string[] = [];
    
    if (fieldSchema instanceof z.ZodString) parts.push('string');
    else if (fieldSchema instanceof z.ZodNumber) parts.push('number');
    else if (fieldSchema instanceof z.ZodBoolean) parts.push('boolean');
    else if (fieldSchema instanceof z.ZodEnum) {
      const values = (fieldSchema as z.ZodEnum<[string, ...string[]]>)._def.values;
      parts.push(`enum: ${values.join(' | ')}`);
    }
    
    if (fieldSchema instanceof z.ZodNumber) {
      const checks = (fieldSchema as z.ZodNumber)._def.checks || [];
      for (const check of checks) {
        if (check.kind === 'min') parts.push(`min: ${check.value}`);
        if (check.kind === 'max') parts.push(`max: ${check.value}`);
      }
    }
    
    return parts.length > 0 ? `(${parts.join(', ')})` : '';
  };

  // Get default value for a field (current value as fallback)
  const getDefaultValue = (fieldId: string): unknown => {
    return (store.getState() as Record<string, unknown>)[fieldId];
  };

  // History log for audit trail
  const patchHistory: HistoryEntry[] = [];
  let historyId = 0;

  return {
    applyPatch(patch: JsonPatchOp[], source: 'user' | 'llm' | 'system' = 'llm'): EditResult {
      const updates: Record<string, unknown> = {};
      
      for (const op of patch) {
        const fieldName = op.path.replace(/^\//, '').split('/')[0];
        
        if (!fieldIds.includes(fieldName)) {
          const result: EditResult = { success: false, error: `Unknown field: ${fieldName}` };
          patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
          return result;
        }
        
        if (op.op === 'remove') {
          updates[fieldName] = getDefaultValue(fieldName);
          continue;
        }
        
        if (op.op === 'replace' || op.op === 'add') {
          const result = validateField(fieldName, op.value);
          if (!result.success) {
            const editResult: EditResult = { success: false, error: `Invalid value for ${fieldName}: ${result.error}` };
            patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result: editResult });
            return editResult;
          }
          updates[fieldName] = result.data;
        }
      }
      
      store.setState(updates as Partial<z.infer<T>>);
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
      const data = store.getState();
      
      let context = `${name} Schema:\n`;
      for (const id of fieldIds) {
        const label = labels[id] || id;
        const desc = getFieldDescription(id);
        context += `  - ${id}: ${label} ${desc}\n`;
      }
      
      context += '\nCurrent Values:\n';
      for (const id of fieldIds) {
        const value = (data as Record<string, unknown>)[id];
        const label = labels[id] || id;
        context += `  ${id}: ${JSON.stringify(value)} (${label})\n`;
      }
      
      context += `
To edit fields, respond with a JSON Patch array (RFC 6902):
[{ "op": "replace", "path": "/fieldName", "value": newValue }]

Examples:
- Single edit: [{ "op": "replace", "path": "/${fieldIds[0] || 'field'}", "value": "newValue" }]
- Multiple: [{ "op": "replace", "path": "/a", "value": 1 }, { "op": "replace", "path": "/b", "value": 2 }]`;
      
      return context;
    },

    getCompactContext(): string {
      const data = store.getState();
      const values = Object.entries(data as Record<string, unknown>)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      
      return `${name}: {${values}}\nJSON Patch: [{"op":"replace","path":"/field","value":x}]`;
    },

    getFunctionSchema(): object {
      return {
        name: `patch_${name.toLowerCase().replace(/\s+/g, '_')}`,
        description: `Apply JSON Patch operations to ${name}. Uses RFC 6902 format.`,
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
                    description: `JSON Pointer to field. Valid paths: ${fieldIds.map(f => `/${f}`).join(', ')}`,
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
    },

    getCurrentValues(): InferData<SchemaFields> {
      return store.getState() as InferData<SchemaFields>;
    },
  };
}
