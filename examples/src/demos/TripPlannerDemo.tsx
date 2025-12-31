import { useState } from 'react';
import { useTripStore } from '../schema';
import { type EditResult } from 'duet-kit';

export function TripPlannerDemo() {
  const { data, set } = useTripStore();
  const [debugTab, setDebugTab] = useState<'context' | 'schema' | 'history'>('context');
  const [jsonInput, setJsonInput] = useState('');
  const [lastResult, setLastResult] = useState<EditResult | null>(null);

  const applyEdit = () => {
    if (!jsonInput.trim()) return;
    const result = useTripStore.llm.applyJSON(jsonInput);
    setLastResult(result);
  };

  const quickEdits = [
    { label: 'Flat: Set budget to $15,000', json: '[{ "op": "replace", "path": "/totalBudget", "value": 15000 }]' },
    { label: 'Flat: SF trip, 18 days', json: '[{ "op": "replace", "path": "/destination", "value": "SF, California, US" }, { "op": "replace", "path": "/days", "value": 18 }]' },
    { label: 'Nested: Switch to Airbnb', json: '[{ "op": "replace", "path": "/accommodation/type", "value": "airbnb" }]' },
    { label: 'Nested: Luxury hotel ($400/night, 5 stars)', json: '[{ "op": "replace", "path": "/accommodation/budgetPerNight", "value": 400 }, { "op": "replace", "path": "/accommodation/stars", "value": 5 }]' },
    { label: 'Invalid: 6 star hotel', json: '[{ "op": "replace", "path": "/accommodation/stars", "value": 6 }]' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Trip Planner</h2>
        <p className="text-gray-600 text-sm">Human edits form, LLM edits via JSON Patch (RFC 6902). Same validated state.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Human Edit */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">👤 Human Edit</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
              <input
                type="text"
                value={data.destination}
                onChange={e => set('destination', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Days</label>
                <input
                  type="number"
                  value={data.days}
                  onChange={e => set('days', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Travelers</label>
                <input
                  type="number"
                  value={data.travelers}
                  onChange={e => set('travelers', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget ($)</label>
              <input
                type="number"
                value={data.totalBudget}
                onChange={e => set('totalBudget', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            {/* Nested field display */}
            <div className="pt-3 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-1">Accommodation (nested)</label>
              <div className="text-xs bg-blue-50 p-2 rounded border border-blue-200">
                <span className="text-blue-700">type:</span> {data.accommodation.type} | 
                <span className="text-blue-700 ml-2">$/night:</span> {data.accommodation.budgetPerNight} | 
                <span className="text-blue-700 ml-2">stars:</span> {data.accommodation.stars ?? 'N/A'}
              </div>
            </div>
            <div className="pt-3 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-1">Shared State</label>
              <pre className="text-xs bg-gray-50 p-2 rounded border overflow-auto max-h-32">
{JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        {/* LLM Edit */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">🤖 LLM Edit</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">JSON Patch (RFC 6902)</label>
              <textarea
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder='[{ "op": "replace", "path": "/totalBudget", "value": 10000 }]'
                className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-xs h-20"
              />
            </div>
            <button
              onClick={applyEdit}
              disabled={!jsonInput.trim()}
              className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
            >
              Run applyJSON()
            </button>
            <div className={`p-2 rounded-md text-sm h-20 overflow-auto ${
              !lastResult ? 'bg-gray-50 border' : lastResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            }`}>
              {lastResult ? (
                <pre className={`text-xs ${lastResult.success ? 'text-green-700' : 'text-red-700'}`}>
{JSON.stringify(lastResult, null, 2)}
                </pre>
              ) : (
                <span className="text-gray-400 text-xs">Result appears here</span>
              )}
            </div>
            <div className="space-y-1">
              {quickEdits.map((edit, i) => (
                <button
                  key={i}
                  onClick={() => setJsonInput(edit.json)}
                  className="block w-full text-left text-xs px-2 py-1.5 bg-gray-50 hover:bg-gray-100 rounded border"
                >
                  {edit.label}
                </button>
              ))}
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
            <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">{useTripStore.llm.getContext()}</pre>
          )}
          {debugTab === 'schema' && (
            <pre className="text-blue-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(useTripStore.llm.getFunctionSchema(), null, 2)}</pre>
          )}
          {debugTab === 'history' && (
            useTripStore.llm.history().length === 0 ? (
              <p className="text-gray-500 text-xs">No patches yet. Apply a JSON Patch to see the debug log.</p>
            ) : (
              <pre className="text-yellow-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(useTripStore.llm.history(), null, 2)}</pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}

