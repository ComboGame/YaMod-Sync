import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App.tsx";
import { applyClientTweaks } from "./client-tweaks";
import { attachModShadow, PortalContainerProvider } from "./lib/shadow";

const queryClient = new QueryClient();

document.addEventListener("DOMContentLoaded", () => {
  applyClientTweaks();

  // Хост панели — пустой элемент в конце body; всё содержимое в его shadow-корне.
  const host = document.createElement("div");
  host.id = "yandex-music-sync-root";
  document.body.appendChild(host);
  const mount = attachModShadow(host);

  createRoot(mount).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PortalContainerProvider container={mount}>
          <App />
        </PortalContainerProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
