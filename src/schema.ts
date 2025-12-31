/**
 * duet-kit - Schema
 * 
 * Thin wrapper around Zod that adds metadata for UI labels and LLM context.
 */

import { z } from 'zod';
import type { SchemaFields, FieldDef, InferData } from './types';

// Schema container with metadata
export class DuetSchema<T extends SchemaFields> {
  constructor(
    public readonly name: string,
    public readonly fields: T
  ) {}

  // Get default values for all fields
  getDefaults(): InferData<T> {
    const defaults = {} as InferData<T>;
    for (const [key, field] of Object.entries(this.fields)) {
      (defaults as Record<string, unknown>)[key] = field.default;
    }
    return defaults;
  }

  // Validate a single field
  validate<K extends keyof T>(field: K, value: unknown): z.SafeParseReturnType<unknown, z.infer<T[K]['schema']>> {
    return this.fields[field].schema.safeParse(value);
  }

  // Validate all fields
  validateAll(data: Partial<InferData<T>>): { success: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key in this.fields) {
        const result = this.fields[key].schema.safeParse(value);
        if (!result.success) {
          errors[key] = result.error.errors[0]?.message || 'Invalid value';
        }
      }
    }
    return { success: Object.keys(errors).length === 0, errors };
  }

  // Get field metadata
  getField(fieldId: string): FieldDef | undefined {
    return this.fields[fieldId as keyof T] as FieldDef | undefined;
  }

  // Get all field IDs
  getFieldIds(): string[] {
    return Object.keys(this.fields);
  }

  // Generate description for LLM context
  getDescription(): string {
    let desc = `Schema: ${this.name}\nFields:\n`;
    
    for (const [id, field] of Object.entries(this.fields) as [string, FieldDef][]) {
      const zodType = this.getZodTypeDescription(field.schema);
      desc += `  - ${id} (${zodType}): ${field.label}\n`;
    }
    
    return desc;
  }

  // Convert Zod schema to JSON Schema (for function calling)
  toJSONSchema(): object {
    const properties: Record<string, object> = {};
    
    for (const [id, field] of Object.entries(this.fields) as [string, FieldDef][]) {
      properties[id] = this.zodToJSONSchema(field.schema, field.label);
    }
    
    return {
      type: 'object',
      properties,
      required: Object.keys(this.fields),
    };
  }

  private getZodTypeDescription(schema: z.ZodType): string {
    if (schema instanceof z.ZodString) return 'string';
    if (schema instanceof z.ZodNumber) return 'number';
    if (schema instanceof z.ZodBoolean) return 'boolean';
    if (schema instanceof z.ZodEnum) return `enum(${schema.options.join('|')})`;
    if (schema instanceof z.ZodOptional) return `optional<${this.getZodTypeDescription(schema.unwrap())}>`;
    return 'unknown';
  }

  private zodToJSONSchema(schema: z.ZodType, description: string): object {
    const base: Record<string, unknown> = { description };
    
    if (schema instanceof z.ZodString) {
      return { ...base, type: 'string' };
    }
    if (schema instanceof z.ZodNumber) {
      const checks = (schema._def as { checks?: Array<{ kind: string; value?: number }> }).checks || [];
      const result: Record<string, unknown> = { ...base, type: 'number' };
      for (const check of checks) {
        if (check.kind === 'min') result.minimum = check.value;
        if (check.kind === 'max') result.maximum = check.value;
      }
      return result;
    }
    if (schema instanceof z.ZodBoolean) {
      return { ...base, type: 'boolean' };
    }
    if (schema instanceof z.ZodEnum) {
      return { ...base, type: 'string', enum: schema.options };
    }
    
    return { ...base, type: 'string' };
  }
}

// Factory function
export function createSchema<T extends SchemaFields>(name: string, fields: T): DuetSchema<T> {
  return new DuetSchema(name, fields);
}

// Helper to define a field (for cleaner syntax)
export function field<T>(
  schema: z.ZodType<T>,
  label: string,
  defaultValue: T
): FieldDef<T> {
  return { schema, label, default: defaultValue };
}
