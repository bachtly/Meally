import { Navigate } from "react-router";
import { Skeleton } from "../../ui";
import { useFeature, useFeaturesState } from "../features/FeaturesProvider";
import { SnapHome } from "./SnapHome";

/** `/`: the camera when Snaps are on, the recipe library otherwise. */
export function SnapsIndex() {
  const on = useFeature("snaps");
  const { isLoading } = useFeaturesState();
  if (isLoading) return <Skeleton className="mx-auto aspect-[3/4] w-full max-w-md" />;
  return on ? <SnapHome /> : <Navigate to="/recipes" replace />;
}
