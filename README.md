# duet-kit

**Shared state for humans and AI.** A Zustand store that both can edit, with validation and an audit trail.

## The Problem

You're building a UI where humans and AI edit the same state—a configuration wizard with AI suggestions, a form where AI auto-fills based on conversation, an editor where AI can make changes alongside you.

The AI needs:
- Schema context to know what fields exist
- Validation to prevent invalid edits  
- A structured format to apply changes

You end up writing boilerplate: prompt templates, JSON parsing, validation logic, error handling. Every team does this differently. You can absolutely build this yourself—duet-kit just makes it simpler.

## The Solution

**duet-kit** gives your Zustand store an LLM interface. One schema, two editors (human + AI), same validation rules. State changes are instant—no round-trip to a server.

```typescript
import { z } from 'zod'
import { createDuet, field } from 'duet-kit'

const useFormStore = createDuet('ContactForm', {
  name: field(z.string().min(1), 'Full Name', ''),
  email: field(z.string().email(), 'Email', ''),
  company: field(z.string(), 'Company', ''),
})

// React UI uses it like any Zustand store
const { data, set } = useFormStore()

// LLM uses the attached bridge
useFormStore.llm.getContext()                              // schema + current values for prompt
useFormStore.llm.applyJSON('[{"op":"replace",...}]')       // JSON Patch from LLM
useFormStore.llm.getFunctionSchema()                       // OpenAI function calling format
useFormStore.llm.history()                                 // audit trail of all patches
```

## Features

- **Zustand-based** — Works like any Zustand store. No new patterns to learn.
- **Zod validation** — Schema defines both types and constraints. LLM edits are validated.
- **JSON Patch (RFC 6902)** — Standard format for edits. Supports nested fields and LLM know it already.
- **Audit trail** — Every patch logged with timestamp, source, and result.
- **Drop-in ready** — `attachLLM()` adds capabilities to existing Zustand + Zod code.
- **TypeScript** — Full type inference from your schema.

## Install

```bash
npm install duet-kit zod zustand
```

> **Peer dependencies:** `zod` and `zustand` are required. `react` is optional (only needed for the React hook).

---

## Quick Start

```typescript
import { z } from 'zod'
import { createDuet, field } from 'duet-kit'

// Define schema with nested fields
const useStore = createDuet('TripBudget', {
  destination: field(z.string().min(1), 'Destination', 'Tokyo'),
  days: field(z.number().min(1).max(365), 'Duration', 7),
  accommodation: field(
    z.object({
      type: z.enum(['hotel', 'airbnb', 'hostel']),
      budgetPerNight: z.number().min(0),
    }),
    'Accommodation',
    { type: 'hotel', budgetPerNight: 150 }
  ),
}, { persist: 'trip-data' })

// React component
function TripForm() {
  const { data, set } = useStore()
  
  return (
    <input 
      value={data.destination}
      onChange={e => set('destination', e.target.value)}
    />
  )
}

// LLM integration
const result = useStore.llm.applyJSON(`[
  { "op": "replace", "path": "/destination", "value": "Paris" },
  { "op": "replace", "path": "/accommodation/type", "value": "airbnb" }
]`)
```

---

## Already Using Zustand + Zod?

Add LLM capabilities without changing your existing code:

```typescript
import { create } from 'zustand'
import { z } from 'zod'
import { attachLLM } from 'duet-kit'

// Your existing store (unchanged)
const schema = z.object({
  title: z.string(),
  priority: z.number().min(1).max(5),
})

const useStore = create<z.infer<typeof schema>>()(() => ({
  title: '',
  priority: 1,
}))

// One line addition
const llm = attachLLM(useStore, schema, { name: 'Task' })

// Now available:
llm.getContext()          // prompt context
llm.applyJSON(...)        // apply LLM output
llm.getFunctionSchema()   // OpenAI tools format
llm.history()             // audit trail
```

No migration. No rewrites. Your store and schema stay exactly as they are.

---

## API Reference

### `createDuet(name, fields, options?)`

Creates a Zustand store with LLM bridge attached.

```typescript
const useStore = createDuet('FormName', {
  fieldName: field(zodSchema, 'Label', defaultValue),
}, {
  persist: 'localStorage-key',  // optional localStorage persistence
  transformContext: (ctx) => `Custom instructions...\n\n${ctx}`,  // customize LLM prompt
  transformFunctionSchema: (schema) => ({ ...schema, description: 'Custom' }),  // customize function schema
})
```

**Options:**
| Option | Description |
|--------|-------------|
| `persist` | localStorage key for persistence (omit for in-memory only) |
| `transformContext` | Transform the default `getContext()` output before returning |
| `transformFunctionSchema` | Transform the default `getFunctionSchema()` output before returning |

Returns a Zustand hook with `.llm` and `.schema` properties.

### `field(schema, label, defaultValue)`

```typescript
field(z.string().min(1), 'Username', '')
field(z.number().min(0).max(100), 'Score', 0)
field(z.enum(['draft', 'published']), 'Status', 'draft')
field(z.boolean(), 'Active', true)

// Nested objects
field(z.object({
  street: z.string(),
  city: z.string(),
}), 'Address', { street: '', city: '' })
```

### `attachLLM(store, zodSchema, options?)`

For existing Zustand stores:

```typescript
const llm = attachLLM(existingStore, existingSchema, {
  name: 'SchemaName',
  labels: { fieldName: 'Human Label' }
})
```

---

## Store API

```typescript
const { data, set, setMany, reset } = useStore()

data.fieldName              // read
set('fieldName', value)     // write single (returns success boolean)
setMany({ a: 1, b: 2 })     // write multiple
reset()                     // restore defaults
```

---

## LLM Bridge API

### `getContext()`

Generates a prompt-ready string with schema and current values:

```
Schema: TripBudget
Fields:
  - destination (string, min: 1): Destination
  - days (number, min: 1, max: 365): Duration
  - accommodation (object): Accommodation

Current Values:
  destination: "Tokyo" (Destination)
  days: 7 (Duration)
  accommodation: {"type":"hotel","budgetPerNight":150} (Accommodation)

To edit fields, respond with a JSON Patch array (RFC 6902):
[{ "op": "replace", "path": "/destination", "value": "Paris" }]
```

### `applyJSON(jsonString, source?)`

Parses and applies JSON Patch from LLM output:

```typescript
// Flat field
const patch1 = '[{ "op": "replace", "path": "/budget", "value": 8000 }]'

// Nested field
const patch2 = '[{ "op": "replace", "path": "/accommodation/type", "value": "airbnb" }]'

const result = useStore.llm.applyJSON(patch1)
// or with source tracking
const result = useStore.llm.applyJSON(patch1, 'llm')

if (result.success) {
  console.log(`Applied ${result.applied} operation(s)`)
} else {
  console.error(result.error)  // validation message
}
```

Accepts both array format `[...]` and wrapped format `{ "patch": [...] }`.

### `getFunctionSchema()`

Returns OpenAI/Anthropic function calling format:

```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [...],
  tools: [{
    type: 'function',
    function: useStore.llm.getFunctionSchema()
  }]
})
```

### `history()`

Returns the full audit trail of all patches:

```typescript
const history = useStore.llm.history()
// [
//   {
//     id: "1",
//     timestamp: 1703782800000,
//     patch: [{ op: "replace", path: "/budget", value: 5000 }],
//     source: "llm",
//     result: { success: true, applied: 1 }
//   }
// ]
```

### `clearHistory()`

Clears the patch history.

### Other Methods

| Method | Description |
|--------|-------------|
| `getCompactContext()` | Shorter context for token-constrained prompts |
| `applyPatch(ops, source?)` | Apply `JsonPatchOp[]` directly (typed) |
| `getCurrentValues()` | Get current store state |

---

## Nested Fields

duet-kit supports nested objects using JSON Pointer paths:

```typescript
const useStore = createDuet('CRMLead', {
  contact: field(z.object({
    name: z.string(),
    email: z.string().email(),
    phone: z.string(),
  }), 'Contact', { name: '', email: '', phone: '' }),
  
  company: field(z.object({
    name: z.string(),
    industry: z.enum(['tech', 'finance', 'healthcare']),
  }), 'Company', { name: '', industry: 'tech' }),
})

// LLM can update nested fields directly
useStore.llm.applyJSON(`[
  { "op": "replace", "path": "/contact/name", "value": "Sarah Chen" },
  { "op": "replace", "path": "/contact/email", "value": "sarah@acme.com" },
  { "op": "replace", "path": "/company/name", "value": "Acme Corp" }
]`)
```

---

## Patch Log (Debugging)

Every patch is logged for debugging. When an LLM makes unexpected changes or validation fails, you can inspect what happened:

```typescript
const history = useStore.llm.history()

// [
//   {
//     id: "1",
//     timestamp: 1703782800000,
//     patch: [{ op: "replace", path: "/budget", value: 5000 }],
//     source: "llm",
//     result: { success: true, applied: 1 }
//   },
//   {
//     id: "2", 
//     timestamp: 1703782810000,
//     patch: [{ op: "replace", path: "/budget", value: 99999999 }],
//     source: "llm",
//     result: { success: false, error: "Number must be at most 1000000" }
//   }
// ]

// Tag the source for filtering
useStore.llm.applyPatch([...], 'user')   // manual edit
useStore.llm.applyPatch([...], 'llm')    // AI edit (default)
useStore.llm.applyPatch([...], 'system') // webhook/automation

useStore.llm.clearHistory()  // reset
```

This is a change log, not a full decision trace. It tells you *what* changed, not *why* (the input, reasoning, or context that led to the change). Useful for debugging and simple undo—not a replacement for proper audit infrastructure.

---

## Use Cases

**Configuration wizards**: User sets options, AI suggests related settings, both iterate until "Create" is clicked. Draft state lives in the client until committed.

**AI-assisted editors**: Human and AI editing together in real-time—proposals, quotes, documents. Like Google Docs, but one editor is an AI.

**Chat-driven UI**: "Change the budget to $5000" → AI parses intent → validated state update → UI reflects instantly.

**Agentic workflows**: AI agents that modify your app state autonomously, with validation guardrails and an audit trail of what changed.

### When to use duet-kit

Use it when human and AI are **editing shared state together in a live session**—especially draft state that doesn't exist in your database yet.

If your architecture is "agent updates DB → client syncs later," you probably don't need this. duet-kit is for interactive, client-side state where both editors see changes immediately.

---

## TypeScript

Types are inferred from your schema:

```typescript
const useStore = createDuet('User', {
  name: field(z.string(), 'Name', ''),
  age: field(z.number(), 'Age', 0),
})

const { data, set } = useStore()
data.name   // string
data.age    // number
set('name', 123)  // TS error
```

---

## Examples

See [`examples/`](./examples) for working demos:

### Trip Planner
- Side-by-side human and AI editing the same state
- Nested fields (accommodation type, budget per night)
- Debug panel showing `.llm.getContext()`, `.llm.getFunctionSchema()`, `.llm.history()`

### CRM Lead Entry
- AI extracts structured data from natural language input
- Voice input with Web Speech API (optional)
- OpenAI integration (optional—works with mock LLM too)
- Nested contact and company fields with validation
- Full audit trail of AI changes

```bash
cd examples && npm install && npm run dev
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Your App                         │
│                                                      │
│   React UI                      LLM / Voice / API    │
│      │                                │              │
│      │ set()                          │ applyJSON()  │
│      ▼                                ▼              │
│   ┌──────────────────────────────────────────────┐   │
│   │              useFormStore                    │   │
│   │                                              │   │
│   │   Zustand      Zod         LLM Bridge        │   │
│   │   (state)   (validation)   (context +        │   │
│   │                             patch log)       │   │
│   └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## Future

I'm hoping state management libraries like Zustand offer this natively in the future. Until then, duet-kit fills the gap.

---

## License

MIT
