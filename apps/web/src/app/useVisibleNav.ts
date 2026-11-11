import { useFeaturesState } from "../features/features/FeaturesProvider";
import { NAV_ITEMS, type NavItem } from "./nav";

/** Nav items whose feature flag (if any) is on. */
export function useVisibleNav(): NavItem[] {
  const { features } = useFeaturesState();
  return NAV_ITEMS.filter((i) => !i.feature || features?.[i.feature]?.enabled === true);
}
