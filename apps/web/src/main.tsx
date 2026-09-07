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
        <main className="tw:mx-auto tw:my-[15vh] tw:grid tw:w-[min(520px,calc(100%-32px))] tw:gap-[12px] tw:rounded-[18px] tw:border tw:border-border tw:bg-card tw:p-[24px] tw:shadow-[0_12px_32px_rgb(0_0_0/8%)]">
          <strong>DevHatch failed to render</strong>
          <span className="tw:font-mono tw:text-[calc(12px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground">{this.state.error.message}</span>
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
