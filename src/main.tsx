import ReactDOM from "react-dom/client";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import "@fontsource/geist/latin.css";
import { routeTree } from "./routeTree.gen";
import "./style.css";

const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("app")!).render(<RouterProvider router={router} />);
