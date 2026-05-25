import { Button } from "@/components/ui/button";

export const NotFound = () => (
  <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
    <p className="text-sm font-mono text-[var(--color-muted-foreground)]">
      404
    </p>
    <h1 className="mt-2 text-3xl font-semibold tracking-tight">
      Page not found
    </h1>
    <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
      The page you tried to open does not exist or was moved. Check the URL or
      head back to the dataset browser.
    </p>
    <div className="mt-6 flex gap-2">
      <Button onClick={() => (window.location.href = "/")}>
        Back to dataset
      </Button>
      <Button variant="outline" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  </div>
);
