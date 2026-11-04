import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Changes when the route changes, so a fresh screen gets a fresh try. */
  resetKey: string;
  onBack(): void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * One screen failing to render must not blank the whole app (a white WebView on Android).
 * Shows what broke with Back / Reload instead, and logs it for chrome://inspect.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[realm] screen crashed', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen center col" style={{ gap: 12, textAlign: 'center' }} data-testid="screen-error">
        <div className="title" style={{ fontSize: 22 }}>
          This page tripped over a rock
        </div>
        <div className="muted" style={{ maxWidth: 360 }}>
          {this.state.error.message || 'Something went wrong while drawing this screen.'}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={() => (this.setState({ error: null }), this.props.onBack())}>
            Back
          </button>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
