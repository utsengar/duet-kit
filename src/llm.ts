/**
 * duet-kit - LLM Utilities
 * 
 * Context generation and JSON Patch application for LLM integration.
 * Uses RFC 6902 JSON Patch format.
 */

import type { SchemaFields, InferData, JsonPatchOp, EditResult, LLMBridge, HistoryEntry } from './types';
import type { DuetSchema } from './schema';
import type { DuetStore } from './store';

/**
 * Create an LLM bridge for a schema + store
 */
export function createLLMBridge<T extends SchemaFields>(
  schema: DuetSchema<T>,
  store: DuetStore<T>
): LLMBridge<T> {
  // History log for audit trail
  const patchHistory: HistoryEntry[] = [];
  let historyId = 0;

  return {
    /**
     * Apply JSON Patch operations (RFC 6902)
     */
    applyPatch(patch: JsonPatchOp[], source: 'user' | 'llm' | 'system' = 'llm'): EditResult {
      const updates: Partial<InferData<T>> = {};
      
      for (const op of patch) {
        const fieldName = op.path.replace(/^\//, '').split('/')[0];
        
        if (!(fieldName in schema.fields)) {
          const result: EditResult = { success: false, error: `Unknown field: ${fieldName}` };
          patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
          return result;
        }
        
        if (op.op === 'remove') {
          const defaultValue = schema.getDefaults()[fieldName as keyof T];
          (updates as Record<string, unknown>)[fieldName] = defaultValue;
          continue;
        }
        
        if (op.op === 'replace' || op.op === 'add') {
          const result = schema.validate(fieldName as keyof T, op.value);
          if (!result.success) {
            const editResult: EditResult = { 
              success: false, 
              error: `Invalid value for ${fieldName}: ${result.error.errors[0]?.message}` 
            };
            patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result: editResult });
            return editResult;
          }
          (updates as Record<string, unknown>)[fieldName] = result.data;
        }
      }
      
      store.getState().setMany(updates);
      const result: EditResult = { success: true, applied: patch.length };
      patchHistory.push({ id: String(++historyId), timestamp: Date.now(), patch, source, result });
      return result;
    },

    /**
     * Apply edits from JSON string (LLM output)
     */
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

    /**
     * Generate context for LLM prompt
     */
    getContext(): string {
      const data = store.getState().data;
      
      let context = schema.getDescription();
      context += '\nCurrent Values:\n';
      
      for (const [id, field] of Object.entries(schema.fields)) {
        const value = data[id as keyof typeof data];
        context += `  ${id}: ${JSON.stringify(value)} (${field.label})\n`;
      }
      
      context += `
To edit fields, respond with a JSON Patch array (RFC 6902):
[{ "op": "replace", "path": "/fieldName", "value": newValue }]

Examples:
- Single edit: [{ "op": "replace", "path": "/budget", "value": 5000 }]
- Multiple: [{ "op": "replace", "path": "/budget", "value": 5000 }, { "op": "replace", "path": "/days", "value": 14 }]`;
      
      return context;
    },

    /**
     * Compact context for constrained prompts
     */
    getCompactContext(): string {
      const data = store.getState().data;
      const values = Object.entries(data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');
      
      return `${schema.name}: {${values}}\nJSON Patch: [{"op":"replace","path":"/field","value":x}]`;
    },

    /**
     * Generate OpenAI/Anthropic function calling schema
     */
    getFunctionSchema(): object {
      return {
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
    },

    /**
     * Get current values
     */
    getCurrentValues(): InferData<T> {
      return store.getState().data;
    },

    /**
     * Get patch history for audit trail
     */
    history(): HistoryEntry[] {
      return [...patchHistory];
    },

    /**
     * Clear patch history
     */
    clearHistory(): void {
      patchHistory.length = 0;
      historyId = 0;
    },
  };
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
