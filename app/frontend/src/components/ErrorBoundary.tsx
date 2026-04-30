import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-gh-bg-base">
          <p className="text-sm text-gh-text-primary font-sans">
            Something went wrong. Please reload the page.
          </p>
          <button
            className="px-3 py-1 text-xs rounded-md border border-gh-btn-border bg-gh-btn-bg text-gh-btn-text hover:bg-gh-btn-hover-bg transition-colors duration-100 cursor-pointer"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
