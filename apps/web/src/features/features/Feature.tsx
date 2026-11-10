import type { ReactNode } from "react";
import type { FeatureKey } from "@meally/shared";
import { useFeature, useFeaturesState } from "./FeaturesProvider";

/** Renders children only when the feature is on; otherwise the fallback (default: nothing). */
export function Feature({ on, fallback = null, children }: { on: FeatureKey; fallback?: ReactNode; children: ReactNode }) {
  return <>{useFeature(on) ? children : fallback}</>;
}

/** Router guard: shows a friendly page when the feature is off. */
export function FeatureRoute({ on, children }: { on: FeatureKey; children: ReactNode }) {
  const enabled = useFeature(on);
  const { isLoading } = useFeaturesState();
  if (isLoading) return <p aria-busy="true">Loading…</p>;
  if (!enabled) {
    return (
      <main role="alert">
        <h1>This feature is turned off on this server</h1>
        <p>Ask the server admin if you need it.</p>
      </main>
    );
  }
  return <>{children}</>;
}
