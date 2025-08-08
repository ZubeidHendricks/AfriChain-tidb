import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './src/App.verichainx'
import KombaiWrapper from './KombaiWrapper'
import ErrorBoundary from '@kombai/react-error-boundary'
import './src/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <KombaiWrapper>
        <App />
      </KombaiWrapper>
    </ErrorBoundary>
  </StrictMode>,
)