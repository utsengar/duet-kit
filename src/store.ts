/**
 * duet-kit - Store
 * 
 * Zustand store factory with validation and persistence.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SchemaFields, InferData, DuetState } from './types';
import type { DuetSchema } from './schema';

export interface StoreOptions {
  /** localStorage key for persistence (omit to disable) */
  persist?: string;
}

export type DuetStore<T extends SchemaFields> = UseBoundStore<StoreApi<DuetState<T>>>;

/**
 * Create a Zustand store bound to a Duet schema
 */
export function createStore<T extends SchemaFields>(
  schema: DuetSchema<T>,
  options: StoreOptions = {}
): DuetStore<T> {
  const initialData = schema.getDefaults();

  const storeCreator = (set: (fn: (state: DuetState<T>) => Partial<DuetState<T>>) => void) => ({
    data: initialData,

    // Set a single field with validation
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

    // Set multiple fields with validation
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

    // Reset to defaults
    reset: () => {
      set(() => ({ data: schema.getDefaults() }));
    },
  });

  // Apply persistence middleware if requested
  if (options.persist) {
    return create<DuetState<T>>()(
      persist(storeCreator, {
        name: options.persist,
        partialize: (state) => ({ data: state.data }),
      })
    );
  }

  return create<DuetState<T>>()(storeCreator);
}

