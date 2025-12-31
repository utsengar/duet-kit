/**
 * duet-kit - attachLLM Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { create } from 'zustand'
import { z } from 'zod'
import { attachLLM } from './attach'

describe('attachLLM', () => {
  const schema = z.object({
    title: z.string().min(1),
    priority: z.number().min(1).max(5),
    done: z.boolean(),
  })

  type State = z.infer<typeof schema>

  const createStore = () => create<State>()(() => ({
    title: '',
    priority: 1,
    done: false,
  }))

  let useStore: ReturnType<typeof createStore>
  let llm: ReturnType<typeof attachLLM>

  beforeEach(() => {
    useStore = createStore()
    llm = attachLLM(useStore, schema, { name: 'Task' })
  })

  describe('applyJSON', () => {
    it('applies valid patch to existing store', () => {
      const result = llm.applyJSON('[{"op":"replace","path":"/title","value":"New Title"}]')
      expect(result.success).toBe(true)
      expect(useStore.getState().title).toBe('New Title')
    })

    it('validates against Zod schema', () => {
      const result = llm.applyJSON('[{"op":"replace","path":"/priority","value":10}]') // max is 5
      expect(result.success).toBe(false)
    })

    it('rejects unknown fields', () => {
      const result = llm.applyJSON('[{"op":"replace","path":"/unknown","value":"x"}]')
      expect(result.success).toBe(false)
    })

    it('does not modify state when validation fails', () => {
      useStore.setState({ title: 'original', priority: 3 })
      
      const result = llm.applyJSON('[{"op":"replace","path":"/priority","value":10}]')
      expect(result.success).toBe(false)
      
      // State unchanged
      expect(useStore.getState().priority).toBe(3)
      expect(useStore.getState().title).toBe('original')
    })
  })

  describe('getContext', () => {
    it('includes schema name', () => {
      const context = llm.getContext()
      expect(context).toContain('Task')
    })

    it('includes field info', () => {
      const context = llm.getContext()
      expect(context).toContain('title')
      expect(context).toContain('priority')
    })

    it('uses custom labels when provided', () => {
      const llmWithLabels = attachLLM(useStore, schema, {
        name: 'Task',
        labels: { title: 'Task Title' }
      })
      const context = llmWithLabels.getContext()
      expect(context).toContain('Task Title')
    })
  })

  describe('getFunctionSchema', () => {
    it('returns OpenAI-compatible schema', () => {
      const fnSchema = llm.getFunctionSchema()
      expect(fnSchema).toHaveProperty('name')
      expect(fnSchema).toHaveProperty('parameters')
    })
  })

  describe('history', () => {
    it('tracks patches', () => {
      llm.applyJSON('[{"op":"replace","path":"/title","value":"Test"}]')
      expect(llm.history()).toHaveLength(1)
    })

    it('clearHistory works', () => {
      llm.applyJSON('[{"op":"replace","path":"/title","value":"Test"}]')
      llm.clearHistory()
      expect(llm.history()).toHaveLength(0)
    })
  })

  describe('getCurrentValues', () => {
    it('returns current store state', () => {
      useStore.setState({ title: 'Updated' })
      const values = llm.getCurrentValues()
      expect(values.title).toBe('Updated')
    })
  })
})

