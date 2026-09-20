import { Component, type ErrorInfo, type ReactNode } from "react";
import { Notice } from "./Notice";

export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Daftar page error", error, info.componentStack);
  }

  componentDidUpdate(prev: Readonly<{ resetKey?: string }>): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="stack">
          <Notice tone="bad">
            This page hit an error. The rest of the desk is still here — try again, or open another
            section.
          </Notice>
          <p className="mono muted">{this.state.error.message}</p>
          <button className="btn ghost" type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
