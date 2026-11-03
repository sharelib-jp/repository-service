import React from "react";
import ReactDOM from "react-dom/client";

import {
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { TanStackDevtools } from "@tanstack/react-devtools";

import { routeTree } from "./routeTree.gen";

import "./index.css";

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(
  document.getElementById("root")!,
).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <TanStackDevtools />}
    </QueryClientProvider>
  </React.StrictMode>,
);
