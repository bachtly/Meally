import { BookOpen, CalendarDays, Ellipsis, ShoppingCart, type LucideIcon } from "lucide-react";
import type { FeatureKey } from "@meally/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  feature?: FeatureKey;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Recipes", icon: BookOpen },
  { to: "/plan", label: "Plan", icon: CalendarDays, feature: "meal-plan" },
  { to: "/shopping", label: "Shopping", icon: ShoppingCart, feature: "shopping-lists" },
  { to: "/more", label: "More", icon: Ellipsis },
];
