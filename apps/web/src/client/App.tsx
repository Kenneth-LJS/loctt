import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";

import { createQueryClient } from "./api/queryClient.ts";
import { SchemaBanner } from "./components/SchemaBanner.tsx";
import { AppBootstrap } from "./context/AppBootstrap.tsx";
import { router } from "./router/index.tsx";

// Devtools are lazy + dev-only so they don't ship to prod. Vite's
// `import.meta.env.DEV` is a static flag — the branch and its import
// are tree-shaken out of the production bundle entirely.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then(m => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

export function App() {
  // Lazy-create once. Putting it in state avoids re-creating on every
  // render (the React Query docs explicitly call this out).
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppBootstrap>
        <SchemaBanner />
        <RouterProvider router={router} />
      </AppBootstrap>
      {ReactQueryDevtools ? (
        <Suspense>
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
