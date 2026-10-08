import React, { Component, createContext, useContext } from 'react';
import { describeViewError, rethrowViewError } from './viewErrorHandling.ts';

type ViewErrorBoundaryProps = {
  children: React.ReactNode;
  resetKey?: unknown;
  title?: string;
  message?: string;
};

type ViewErrorBoundaryState = {
  failed: boolean;
  error: unknown;
  resetKey: unknown;
};

const ViewErrorContext = createContext<(error: unknown) => void>(rethrowViewError);

/** Use only at an owned asynchronous callback; errors without a boundary still throw. */
export const useViewErrorHandler = () => useContext(ViewErrorContext);

export const ViewFailure: React.FC<{
  error: unknown;
  onRetry: () => void;
  title?: string;
  message?: string;
}> = ({ error, onRetry, title = 'Could not display this view.', message = 'Your analysis is unchanged.' }) => (
  <div className="w-full h-full min-h-48 flex flex-col items-center justify-center gap-4 p-6 text-emerald-200">
    <p role="alert" className="font-semibold">{title}</p>
    <p className="text-sm text-emerald-100/70">{message}</p>
    <button type="button" className="rounded-xl border border-emerald-500/30 px-4 py-2" onClick={onRetry}>Retry view</button>
    <details className="w-full max-w-xl text-sm text-emerald-100/60">
      <summary className="cursor-pointer">Error details</summary>
      <pre className="mt-3 whitespace-pre-wrap break-words">{describeViewError(error)}</pre>
    </details>
  </div>
);

/** Keep this below analysis ownership so retry remounts the view, never the parse. */
class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  declare readonly props: Readonly<ViewErrorBoundaryProps>;
  declare setState: (state: Partial<ViewErrorBoundaryState>) => void;
  state: ViewErrorBoundaryState;

  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { failed: false, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props: ViewErrorBoundaryProps, state: ViewErrorBoundaryState) {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { failed: false, error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Babel view failed:', error, info.componentStack);
  }

  reportError = (error: unknown) => {
    console.error('Babel view callback failed:', error);
    this.setState({ failed: true, error });
  };

  retry = () => this.setState({ failed: false, error: null });

  render() {
    if (this.state.failed) return <ViewFailure error={this.state.error} onRetry={this.retry}
      title={this.props.title} message={this.props.message} />;
    return <ViewErrorContext.Provider value={this.reportError}>{this.props.children}</ViewErrorContext.Provider>;
  }
}

export default ViewErrorBoundary;
