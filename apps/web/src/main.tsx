import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.tsx'
import { AppSettingsProvider } from './app/providers/SettingsProvider.tsx'
import './app/styles/base.css'
import { AuthGate } from './features/auth/AuthGate.tsx'
import { applyTheme, cachedTheme } from './shared/theme/themes.ts'

applyTheme(cachedTheme())

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DevHatch render failed', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <strong>DevHatch failed to render</strong>
          <span>{this.state.error.message}</span>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        {(auth) => (
          <AppSettingsProvider>
            <App {...auth} />
          </AppSettingsProvider>
        )}
      </AuthGate>
    </AppErrorBoundary>
  </StrictMode>,
)
