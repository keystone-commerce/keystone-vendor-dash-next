"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import { ThemeProvider, useTheme } from "@/lib/use-theme";

/**
 * Sonner doesn't read our context on its own — it needs the theme passed in, so
 * toasts follow the app's light/dark selection. Lives in its own component because
 * it must be *inside* ThemeProvider to call useTheme().
 */
function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={theme} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Zoho webhooks sync invoices server-side, so the browser can hold stale
          // counts indefinitely. Refetching when the tab regains focus picks those
          // up; staleTime still prevents a burst of duplicate requests.
          queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
