import { Suspense, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DatasetBrowser } from "@/pages/DatasetBrowser";
import { NotFound } from "@/pages/NotFound";
import { queryClient } from "@/lib/queryClient";

const usePathname = () => {
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return pathname;
};

const PageFallback = () => (
  <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[var(--color-muted-foreground)]">
    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
  </div>
);

export const App = () => {
  const pathname = usePathname();
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={150}>
          <Suspense fallback={<PageFallback />}>
            {pathname === "/" ? <DatasetBrowser /> : <NotFound />}
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
