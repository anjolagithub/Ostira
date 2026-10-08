"use client";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NavProvider, RuntimeProvider, pathToRoute, routeToPath, type Nav } from "../ui/runtime";
import { liveSource } from "../ui/sources";
import { Shell } from "../ui/views";

const source = liveSource();

export function App() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const nav = useMemo<Nav>(() => ({
    route: pathToRoute(pathname, search.toString()),
    href: routeToPath,
    go: (r, opts) => (opts?.replace ? router.replace(routeToPath(r), { scroll: false }) : router.push(routeToPath(r))),
  }), [pathname, search, router]);
  return (
    <RuntimeProvider source={source}>
      <NavProvider value={nav}>
        <Shell />
      </NavProvider>
    </RuntimeProvider>
  );
}
