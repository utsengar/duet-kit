/**
 * duet-kit - Core Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createDuet } from './duet'
import { field } from './schema'
import { z } from 'zod'

describe('createDuet', () => {
  const createTestStore = () => createDuet('TestStore', {
    name: field(z.string().min(1), 'Name', 'default'),
    count: field(z.number().min(0).max(100), 'Count', 0),
    active: field(z.boolean(), 'Active', false),
  })

  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    useStore = createTestStore()
  })

  describe('initialization', () => {
    it('creates store with default values', () => {
      const { data } = useStore.getState()
      expect(data.name).toBe('default')
      expect(data.count).toBe(0)
      expect(data.active).toBe(false)
    })

    it('attaches schema', () => {
      expect(useStore.schema).toBeDefined()
      expect(useStore.schema.name).toBe('TestStore')
    })

    it('attaches llm bridge', () => {
      expect(useStore.llm).toBeDefined()
      expect(typeof useStore.llm.getContext).toBe('function')
      expect(typeof useStore.llm.applyJSON).toBe('function')
    })
  })

  describe('set()', () => {
    it('updates valid value', () => {
      const result = useStore.getState().set('name', 'updated')
      expect(result).toBe(true)
      expect(useStore.getState().data.name).toBe('updated')
    })

    it('rejects invalid value (fails validation)', () => {
      const result = useStore.getState().set('count', 999) // exceeds max 100
      expect(result).toBe(false)
      expect(useStore.getState().data.count).toBe(0) // unchanged
    })

    it('rejects empty string when min length required', () => {
      const result = useStore.getState().set('name', '')
      expect(result).toBe(false)
    })
  })

  describe('setMany()', () => {
    it('updates multiple fields', () => {
      const result = useStore.getState().setMany({ name: 'new', count: 50 })
      expect(result).toBe(true)
      expect(useStore.getState().data.name).toBe('new')
      expect(useStore.getState().data.count).toBe(50)
    })

    it('rejects if any field invalid', () => {
      const result = useStore.getState().setMany({ name: 'valid', count: 999 })
      expect(result).toBe(false)
    })
  })

  describe('reset()', () => {
    it('restores default values', () => {
      useStore.getState().set('name', 'changed')
      useStore.getState().set('count', 50)
      useStore.getState().reset()
      
      expect(useStore.getState().data.name).toBe('default')
      expect(useStore.getState().data.count).toBe(0)
    })
  })
})

describe('applyJSON', () => {
  const createTestStore = () => createDuet('TestStore', {
    name: field(z.string().min(1), 'Name', 'default'),
    count: field(z.number().min(0).max(100), 'Count', 0),
  })

  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    useStore = createTestStore()
  })

  describe('valid patches', () => {
    it('applies single replace operation', () => {
      const result = useStore.llm.applyJSON('[{"op":"replace","path":"/name","value":"test"}]')
      expect(result.success).toBe(true)
      if (result.success) expect(result.applied).toBe(1)
      expect(useStore.getState().data.name).toBe('test')
    })

    it('applies multiple operations', () => {
      const result = useStore.llm.applyJSON('[{"op":"replace","path":"/name","value":"new"},{"op":"replace","path":"/count","value":42}]')
      expect(result.success).toBe(true)
      if (result.success) expect(result.applied).toBe(2)
    })

    it('accepts wrapped format { patch: [...] }', () => {
      const result = useStore.llm.applyJSON('{"patch":[{"op":"replace","path":"/count","value":10}]}')
      expect(result.success).toBe(true)
    })
  })

  describe('invalid patches', () => {
    it('rejects unknown field', () => {
      const result = useStore.llm.applyJSON('[{"op":"replace","path":"/unknown","value":"x"}]')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toContain('Unknown field')
    })

    it('rejects value failing validation and does not modify state', () => {
      // Set initial known value
      useStore.getState().set('count', 50)
      expect(useStore.getState().data.count).toBe(50)
      
      // Try invalid update
      const result = useStore.llm.applyJSON('[{"op":"replace","path":"/count","value":999}]')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toContain('Invalid value')
      
      // Verify state unchanged
      expect(useStore.getState().data.count).toBe(50)
    })

    it('rejects malformed JSON', () => {
      const result = useStore.llm.applyJSON('not json')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toContain('JSON parse error')
    })

    it('rejects non-array format', () => {
      const result = useStore.llm.applyJSON('{"op":"replace"}')
      expect(result.success).toBe(false)
    })

    it('does not partially apply when one operation fails', () => {
      // Set initial values
      useStore.getState().setMany({ name: 'original', count: 10 })
      
      // First op valid, second invalid
      const result = useStore.llm.applyJSON('[{"op":"replace","path":"/name","value":"new"},{"op":"replace","path":"/count","value":999}]')
      expect(result.success).toBe(false)
      
      // Neither should be applied (atomic)
      expect(useStore.getState().data.name).toBe('original')
      expect(useStore.getState().data.count).toBe(10)
    })
  })
})

describe('nested fields', () => {
  const createNestedStore = () => createDuet('NestedStore', {
    contact: field(z.object({
      name: z.string(),
      email: z.string(),
      phone: z.string(),
    }), 'Contact', { name: '', email: '', phone: '' }),
  })

  let useStore: ReturnType<typeof createNestedStore>

  beforeEach(() => {
    useStore = createNestedStore()
  })

  it('applies nested path', () => {
    const result = useStore.llm.applyJSON('[{"op":"replace","path":"/contact/name","value":"John"}]')
    expect(result.success).toBe(true)
    expect(useStore.getState().data.contact.name).toBe('John')
  })

  it('validates nested value against schema', () => {
    // Create a store with strict validation
    const strictStore = createDuet('StrictStore', {
      settings: field(z.object({
        count: z.number().min(0).max(10),
      }), 'Settings', { count: 0 }),
    })
    
    const result = strictStore.llm.applyJSON('[{"op":"replace","path":"/settings/count","value":999}]')
    expect(result.success).toBe(false)
  })

  it('applies multiple nested updates', () => {
    const result = useStore.llm.applyJSON(`[
      {"op":"replace","path":"/contact/name","value":"Jane"},
      {"op":"replace","path":"/contact/email","value":"jane@example.com"}
    ]`)
    expect(result.success).toBe(true)
    expect(useStore.getState().data.contact.name).toBe('Jane')
    expect(useStore.getState().data.contact.email).toBe('jane@example.com')
  })
})

describe('history', () => {
  const createTestStore = () => createDuet('TestStore', {
    value: field(z.number().min(0).max(100), 'Value', 0),
  })

  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    useStore = createTestStore()
    useStore.llm.clearHistory()
  })

  it('logs successful patches', () => {
    useStore.llm.applyJSON('[{"op":"replace","path":"/value","value":50}]')
    
    const history = useStore.llm.history()
    expect(history).toHaveLength(1)
    expect(history[0].result.success).toBe(true)
    expect(history[0].source).toBe('llm')
  })

  it('logs failed patches', () => {
    useStore.llm.applyJSON('[{"op":"replace","path":"/value","value":999}]')
    
    const history = useStore.llm.history()
    expect(history).toHaveLength(1)
    expect(history[0].result.success).toBe(false)
  })

  it('tracks source', () => {
    useStore.llm.applyPatch([{ op: 'replace', path: '/value', value: 10 }], 'user')
    useStore.llm.applyPatch([{ op: 'replace', path: '/value', value: 20 }], 'system')
    
    const history = useStore.llm.history()
    expect(history[0].source).toBe('user')
    expect(history[1].source).toBe('system')
  })

  it('clearHistory() empties log', () => {
    useStore.llm.applyJSON('[{"op":"replace","path":"/value","value":50}]')
    expect(useStore.llm.history()).toHaveLength(1)
    
    useStore.llm.clearHistory()
    expect(useStore.llm.history()).toHaveLength(0)
  })

  it('includes timestamp', () => {
    const before = Date.now()
    useStore.llm.applyJSON('[{"op":"replace","path":"/value","value":50}]')
    const after = Date.now()
    
    const history = useStore.llm.history()
    expect(history[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(history[0].timestamp).toBeLessThanOrEqual(after)
  })
})

describe('getContext', () => {
  it('includes schema name', () => {
    const useStore = createDuet('MyForm', {
      field: field(z.string(), 'Label', ''),
    })
    const context = useStore.llm.getContext()
    expect(context).toContain('MyForm')
  })

  it('includes field labels', () => {
    const useStore = createDuet('Form', {
      username: field(z.string(), 'User Name', ''),
    })
    const context = useStore.llm.getContext()
    expect(context).toContain('User Name')
  })

  it('includes current values', () => {
    const useStore = createDuet('Form', {
      name: field(z.string(), 'Name', 'initial'),
    })
    const context = useStore.llm.getContext()
    expect(context).toContain('initial')
  })
})

describe('getFunctionSchema', () => {
  it('returns valid function schema', () => {
    const useStore = createDuet('Task', {
      title: field(z.string(), 'Title', ''),
    })
    const schema = useStore.llm.getFunctionSchema()
    
    expect(schema).toHaveProperty('name')
    expect(schema).toHaveProperty('description')
    expect(schema).toHaveProperty('parameters')
  })
})

describe('transformContext', () => {
  it('applies transform to context output', () => {
    const useStore = createDuet('Form', {
      name: field(z.string(), 'Name', ''),
    }, {
      transformContext: (ctx) => `PREFIX\n${ctx}\nSUFFIX`
    })
    
    const context = useStore.llm.getContext()
    expect(context.startsWith('PREFIX')).toBe(true)
    expect(context.endsWith('SUFFIX')).toBe(true)
    expect(context).toContain('Form') // original content still there
  })

  it('does not transform when option not provided', () => {
    const useStore = createDuet('Form', {
      name: field(z.string(), 'Name', ''),
    })
    
    const context = useStore.llm.getContext()
    expect(context.startsWith('PREFIX')).toBe(false)
  })
})

describe('transformFunctionSchema', () => {
  it('applies transform to function schema output', () => {
    const useStore = createDuet('Task', {
      title: field(z.string(), 'Title', ''),
    }, {
      transformFunctionSchema: (schema) => ({
        ...schema,
        description: 'Custom description'
      })
    })
    
    const schema = useStore.llm.getFunctionSchema() as { description: string }
    expect(schema.description).toBe('Custom description')
  })

  it('does not transform when option not provided', () => {
    const useStore = createDuet('Task', {
      title: field(z.string(), 'Title', ''),
    })
    
    const schema = useStore.llm.getFunctionSchema() as { description: string }
    expect(schema.description).toContain('Task') // default description
  })
})

