import { useState, useRef } from 'react';
import { createDuet, field, z, type EditResult } from 'duet-kit';

// Nested schemas for CRM
const contactSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  role: z.string(),
});

const companySchema = z.object({
  name: z.string(),
  industry: z.enum(['tech', 'finance', 'healthcare', 'retail', 'other']),
  size: z.enum(['startup', 'smb', 'enterprise']),
});

// CRM Lead schema with nested fields
// Uses transformContext to add custom instructions for the LLM
const useLead = createDuet('Lead', {
  // Nested: Contact info
  contact: field(contactSchema, 'Contact', {
    name: '',
    email: '',
    phone: '',
    role: '',
  }),
  
  // Nested: Company info
  company: field(companySchema, 'Company', {
    name: '',
    industry: 'tech',
    size: 'startup',
  }),
  
  // Flat fields
  dealSize: field(z.number().min(0), 'Deal Size ($)', 0),
  stage: field(z.enum(['prospect', 'qualified', 'proposal', 'negotiation', 'closed']), 'Stage', 'prospect'),
  notes: field(z.string(), 'Notes', ''),
}, { 
  persist: 'crm-lead-demo',
  // Custom prompt transform: add sales-specific instructions
  transformContext: (ctx: string) => 
    `You are a sales assistant extracting CRM lead data from voice transcripts.\n\n${ctx}\n\nExtract as many fields as possible. Use "k" suffix for thousands (e.g., "50k" = 50000).`,
});

// Call OpenAI API (via Vite proxy to avoid CORS)
async function callOpenAI(apiKey: string, transcript: string, context: string): Promise<string> {
  const response = await fetch('/api/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You extract structured CRM lead data from voice transcripts.\n\n${context}\n\nExtract any information and return ONLY a JSON Patch array.`
        },
        { role: 'user', content: `Extract CRM lead fields from: "${transcript}"` }
      ],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

// Mock LLM - returns JSON Patch format (RFC 6902) with nested paths
function mockLLMParse(transcript: string): string {
  const lower = transcript.toLowerCase();
  const patch: Array<{ op: 'replace'; path: string; value: unknown }> = [];

  // Nested: /company/name
  const companyMatch = lower.match(/(?:from|at|with)\s+([a-z\s]+?)(?:\.|,|$|\s+(?:they|she|he|deal|email|phone))/i);
  if (companyMatch) patch.push({ op: 'replace', path: '/company/name', value: companyMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase()) });

  // Nested: /contact/name
  const contactMatch = transcript.match(/(?:met with|spoke to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (contactMatch) patch.push({ op: 'replace', path: '/contact/name', value: contactMatch[1] });

  // Nested: /contact/email
  const emailMatch = transcript.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) patch.push({ op: 'replace', path: '/contact/email', value: emailMatch[1] });

  // Nested: /contact/phone
  const phoneMatch = transcript.match(/(\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}|\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) patch.push({ op: 'replace', path: '/contact/phone', value: phoneMatch[1] });

  // Flat: /dealSize
  const dealMatch = lower.match(/(\d+)k/);
  if (dealMatch) patch.push({ op: 'replace', path: '/dealSize', value: parseInt(dealMatch[1]) * 1000 });

  // Flat: /stage
  if (lower.includes('qualified')) patch.push({ op: 'replace', path: '/stage', value: 'qualified' });
  else if (lower.includes('proposal')) patch.push({ op: 'replace', path: '/stage', value: 'proposal' });

  // Nested: /company/size based on keywords
  if (lower.includes('enterprise')) patch.push({ op: 'replace', path: '/company/size', value: 'enterprise' });
  else if (lower.includes('startup')) patch.push({ op: 'replace', path: '/company/size', value: 'startup' });

  // Flat: /notes
  const notesMatch = lower.match(/interested in\s+([^.]+)/);
  if (notesMatch) patch.push({ op: 'replace', path: '/notes', value: `Interested in ${notesMatch[1]}` });

  return JSON.stringify(patch);
}

const EXAMPLE_TRANSCRIPT = "Just met with Sarah Chen from Acme Corp. It's an enterprise company. Deal size around 50K. Email is sarah@acme.com, phone 555-0123. Moving them to qualified stage. They're interested in the enterprise plan.";

export function CRMVoiceDemo() {
  const { data, set, reset } = useLead();
  const [apiKey, setApiKey] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastResult, setLastResult] = useState<EditResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [llmResponse, setLlmResponse] = useState('');
  const [error, setError] = useState('');
  const [debugTab, setDebugTab] = useState<'context' | 'schema' | 'history'>('context');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const hasApiKey = apiKey.trim().length > 0;

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Speech recognition not supported. Try Chrome.'); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setTranscript(text);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setError('');
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const processWithLLM = async (text: string) => {
    if (!text.trim()) return;
    setIsProcessing(true);
    setError('');
    setLlmResponse('');

    try {
      const response = hasApiKey
        ? await callOpenAI(apiKey, text, useLead.llm.getContext())
        : mockLLMParse(text);

      setLlmResponse(response);
      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      setLastResult(useLead.llm.applyJSON(jsonStr));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">CRM Voice Dictation</h2>
        <p className="text-gray-600 text-sm">
          {hasApiKey ? 'Speak naturally → OpenAI extracts nested fields → Form updates' : 'Demo mode: See how LLM extracts nested CRM fields from natural language'}
        </p>
      </div>

      {/* API Key */}
      <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div className="flex items-center gap-3">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="OpenAI API Key (sk-...) for voice + real LLM"
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm bg-white"
          />
          <span className={`text-xs px-2 py-1 rounded ${hasApiKey ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
            {hasApiKey ? '✓ OpenAI' : 'Demo'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          {hasApiKey ? (
            <>
              <h3 className="font-semibold text-gray-900 mb-3">🎤 Voice Input</h3>
              
              <button
                onClick={isListening ? stopListening : startListening}
                className={`w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 ${
                  isListening ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'
                }`}
              >
                {isListening ? <><span className="w-2 h-2 bg-white rounded-full animate-pulse" /> Stop Recording</> : '🎙️ Start Dictation'}
              </button>

              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                placeholder="Speak or type your notes..."
                className="w-full mt-3 px-3 py-2 border border-gray-300 rounded-md h-24 text-sm"
              />

              <button
                onClick={() => processWithLLM(transcript)}
                disabled={!transcript.trim() || isProcessing}
                className="w-full mt-2 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'Extract Fields (OpenAI)'}
              </button>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 mb-3">📝 Example Transcript</h3>
              <p className="text-xs text-gray-500 mb-3">Add an OpenAI key above to enable voice dictation</p>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 italic">
                "{EXAMPLE_TRANSCRIPT}"
              </div>

              <button
                onClick={() => processWithLLM(EXAMPLE_TRANSCRIPT)}
                disabled={isProcessing}
                className="w-full mt-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'Extract Fields (Mock LLM)'}
              </button>
            </>
          )}

          {error && <div className="mt-3 p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}
          {lastResult && !error && (
            <div className={`mt-3 p-2 text-xs rounded ${lastResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {lastResult.success ? `✓ Extracted ${lastResult.applied} field(s)` : lastResult.error}
            </div>
          )}
          {llmResponse && (
            <pre className="mt-3 text-xs bg-gray-900 text-green-400 p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap">
{(() => {
  try {
    return JSON.stringify(JSON.parse(llmResponse), null, 2);
  } catch {
    return llmResponse;
  }
})()}
            </pre>
          )}
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-900">📋 Lead Form</h3>
            <button onClick={() => reset()} className="text-xs text-gray-500">Reset</button>
          </div>

          <div className="space-y-3">
            {/* Nested: Contact */}
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <label className="block text-xs font-medium text-blue-700 mb-2">Contact (nested: /contact/*)</label>
              <div className="space-y-2">
                <input type="text" value={data.contact.name} onChange={e => set('contact', { ...data.contact, name: e.target.value })} placeholder="Name" className="w-full px-3 py-1.5 border rounded text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="email" value={data.contact.email} onChange={e => set('contact', { ...data.contact, email: e.target.value })} placeholder="Email" className="px-3 py-1.5 border rounded text-sm" />
                  <input type="tel" value={data.contact.phone} onChange={e => set('contact', { ...data.contact, phone: e.target.value })} placeholder="Phone" className="px-3 py-1.5 border rounded text-sm" />
                </div>
                <input type="text" value={data.contact.role} onChange={e => set('contact', { ...data.contact, role: e.target.value })} placeholder="Role" className="w-full px-3 py-1.5 border rounded text-sm" />
              </div>
            </div>

            {/* Nested: Company */}
            <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
              <label className="block text-xs font-medium text-purple-700 mb-2">Company (nested: /company/*)</label>
              <div className="space-y-2">
                <input type="text" value={data.company.name} onChange={e => set('company', { ...data.company, name: e.target.value })} placeholder="Company Name" className="w-full px-3 py-1.5 border rounded text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={data.company.industry} onChange={e => set('company', { ...data.company, industry: e.target.value as typeof data.company.industry })} className="px-3 py-1.5 border rounded text-sm">
                    <option value="tech">Tech</option>
                    <option value="finance">Finance</option>
                    <option value="healthcare">Healthcare</option>
                    <option value="retail">Retail</option>
                    <option value="other">Other</option>
                  </select>
                  <select value={data.company.size} onChange={e => set('company', { ...data.company, size: e.target.value as typeof data.company.size })} className="px-3 py-1.5 border rounded text-sm">
                    <option value="startup">Startup</option>
                    <option value="smb">SMB</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Flat fields */}
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={data.dealSize} onChange={e => set('dealSize', parseInt(e.target.value) || 0)} placeholder="Deal Size ($)" className="px-3 py-1.5 border rounded text-sm" />
              <select value={data.stage} onChange={e => set('stage', e.target.value as typeof data.stage)} className="px-3 py-1.5 border rounded text-sm">
                <option value="prospect">Prospect</option>
                <option value="qualified">Qualified</option>
                <option value="proposal">Proposal</option>
                <option value="negotiation">Negotiation</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <textarea value={data.notes} onChange={e => set('notes', e.target.value)} placeholder="Notes" className="w-full px-3 py-1.5 border rounded text-sm h-14" />
            
            <div className="pt-2 border-t">
              <pre className="text-xs bg-gray-50 p-2 rounded border overflow-auto max-h-32">{JSON.stringify(data, null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* Debug Panel */}
      <div className="mt-6 bg-gray-900 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-700">
          {(['context', 'schema', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setDebugTab(tab)}
              className={`px-3 py-2 text-xs font-medium ${debugTab === tab ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
            >
              {tab === 'context' && '.llm.getContext()'}
              {tab === 'schema' && '.llm.getFunctionSchema()'}
              {tab === 'history' && '.llm.history()'}
            </button>
          ))}
        </div>
        <div className="p-3 max-h-48 overflow-auto">
          {debugTab === 'context' && (
            <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">{useLead.llm.getContext()}</pre>
          )}
          {debugTab === 'schema' && (
            <pre className="text-blue-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(useLead.llm.getFunctionSchema(), null, 2)}</pre>
          )}
          {debugTab === 'history' && (
            useLead.llm.history().length === 0 ? (
              <p className="text-gray-500 text-xs">No patches yet. Extract fields to see the debug log.</p>
            ) : (
              <pre className="text-yellow-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(useLead.llm.history(), null, 2)}</pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}
