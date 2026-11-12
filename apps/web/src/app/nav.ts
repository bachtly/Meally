import { BookMarked, BookOpen, CalendarDays, Ellipsis, Users, ShoppingCart, type LucideIcon } from "lucide-react";
import type { FeatureKey } from "@meally/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  feature?: FeatureKey;
  /** Shown in the desktop sidebar only; on phones it lives under More. */
  desktopOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/recipes", label: "Recipes", icon: BookOpen },
  { to: "/cookbooks", label: "Cookbooks", icon: BookMarked, feature: "cookbooks", desktopOnly: true },
  { to: "/plan", label: "Plan", icon: CalendarDays, feature: "meal-plan" },
  { to: "/shopping", label: "Shopping", icon: ShoppingCart, feature: "shopping-lists" },
  { to: "/friends", label: "Friends", icon: Users, feature: "friends", desktopOnly: true },
  { to: "/more", label: "More", icon: Ellipsis },
];
