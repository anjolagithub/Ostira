import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import data from "./dataset.json";
import type { Dataset } from "@ostira/core/dataset";
import { NavProvider, RuntimeProvider, routeToPath, type Nav, type Route } from "../ui/runtime";
import { snapshotSource } from "../ui/sources";
import { Shell } from "../ui/views";

const source = snapshotSource(data as unknown as Dataset);

function initialRoute(): Route {
  const h = location.hash.replace("#", "");
  if (h === "lab") return { page: "lab" };
  if (h === "console") return { page: "console" };
  if (h === "policy") return { page: "policy" };
  return { page: "overview" };
}

function Preview() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const nav = useMemo<Nav>(() => ({
    route,
    href: (r) => "#" + (r.page === "overview" ? "" : r.page),
    go: (r) => setRoute(r),
  }), [route]);
  return (
    <RuntimeProvider source={source}>
      <NavProvider value={nav}>
        <Shell />
      </NavProvider>
    </RuntimeProvider>
  );
}

void routeToPath;
createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
