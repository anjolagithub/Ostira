import { Suspense } from "react";
import { App } from "../app";

export default function Page() {
  return (
    <Suspense>
      <App />
    </Suspense>
  );
}
