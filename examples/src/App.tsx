import { useState } from 'react';
import { TripPlannerDemo } from './demos/TripPlannerDemo';
import { CRMVoiceDemo } from './demos/CRMVoiceDemo';

type Demo = 'trip' | 'crm';

export default function App() {
  const [activeDemo, setActiveDemo] = useState<Demo>('trip');

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between py-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">duet-kit</h1>
              <p className="text-sm text-gray-500">
                Zustand store + Zod schema + patch log. Shared state for humans and LLMs.
              </p>
            </div>
            <a 
              href="https://github.com/utsengar/duet-kit" 
              target="_blank"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              GitHub →
            </a>
          </div>

          {/* Tabs */}
          <div className="flex gap-6">
            <button
              onClick={() => setActiveDemo('trip')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                activeDemo === 'trip'
                  ? 'text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Trip Planner
              {activeDemo === 'trip' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveDemo('crm')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                activeDemo === 'crm'
                  ? 'text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              CRM Voice
              {activeDemo === 'crm' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Demo Content */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeDemo === 'trip' && <TripPlannerDemo />}
        {activeDemo === 'crm' && <CRMVoiceDemo />}
      </div>

      {/* Footer */}
      <div className="max-w-5xl mx-auto px-6 pb-8">
        <p className="text-xs text-gray-400 text-center">
          Both demos use <code className="font-mono">createDuet()</code> — same validated state, human + LLM edits
        </p>
      </div>
    </div>
  );
}
