import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Clear persisted state on load (demo only - schema changes frequently)
localStorage.removeItem('duet-kit-example')
localStorage.removeItem('crm-lead-demo')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

