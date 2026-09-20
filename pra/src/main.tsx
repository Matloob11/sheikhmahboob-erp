import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import { registerDaftarPwa } from "./lib/pwa";
import { applyTheme } from "./lib/theme";
import "./index.css";

applyTheme();
registerDaftarPwa();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const router = createBrowserRouter([{ path: "*", element: <App /> }], { basename });

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
