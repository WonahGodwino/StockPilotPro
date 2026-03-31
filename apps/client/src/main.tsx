import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { getInitialDarkMode, applyDarkMode } from '@/lib/darkMode'

// Apply dark mode class before first render to prevent flash of unstyled content
applyDarkMode(getInitialDarkMode())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
