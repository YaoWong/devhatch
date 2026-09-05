import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import App from './app/App.tsx'
import { AppSettingsProvider } from './app/providers/SettingsProvider.tsx'
import './app/styles/base.css'
import { AuthGate } from './features/auth/AuthGate.tsx'
import { applyDisplaySettings, cachedDisplaySettings } from './shared/theme/displaySettings.ts'
import { applyTheme, cachedTheme } from './shared/theme/themes.ts'

applyTheme(cachedTheme())
const initialDisplaySettings = cachedDisplaySettings()
applyDisplaySettings(initialDisplaySettings.fontSizePx, initialDisplaySettings.uiScalePercent)

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
          <Button className="tw:h-10 tw:w-fit tw:rounded-full tw:bg-foreground tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground! tw:[@media(pointer:coarse)]:h-11" type="button" onClick={() => window.location.reload()}>Reload</Button>
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
