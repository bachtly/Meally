import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import type { FeatureKey } from "@meally/shared";
import { api } from "../../lib/api";

export interface FeatureInfo {
  enabled: boolean;
  locked: boolean;
  source: string;
  label: string;
  description: string;
}
type FeatureMap = Partial<Record<FeatureKey, FeatureInfo>>;
interface Ctx {
  features: FeatureMap | undefined;
  isLoading: boolean;
  isError: boolean;
}

const FeaturesContext = createContext<Ctx>({ features: undefined, isLoading: true, isError: false });

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ["features"],
    queryFn: () => api<{ features: FeatureMap }>("/features"),
    staleTime: 60_000,
  });
  return (
    <FeaturesContext.Provider value={{ features: q.data?.features, isLoading: q.isLoading, isError: q.isError }}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeaturesState(): Ctx {
  return useContext(FeaturesContext);
}

/** True only once the server has said the feature is on. */
export function useFeature(key: FeatureKey): boolean {
  return useContext(FeaturesContext).features?.[key]?.enabled === true;
}
