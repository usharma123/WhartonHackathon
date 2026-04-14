"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";

const defaultUrl = "http://127.0.0.1:3210";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? defaultUrl),
  );

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
