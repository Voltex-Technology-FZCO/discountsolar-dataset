import * as React from "react";
import { Button } from "@/components/ui/button";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary]", error, info);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border border-[var(--color-destructive)]/40 bg-[var(--color-card)] p-6 shadow">
          <h1 className="text-xl font-semibold text-[var(--color-destructive)]">
            Something broke
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            An unexpected error occurred while rendering the page.
          </p>
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-[var(--color-muted)] p-3 text-xs">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : null}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
