import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router/index.tsx";

export function App() {
  return <RouterProvider router={router} />;
}
