/** The only list of feature flags. See docs/design/03-architecture.md#feature-flags. */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  default: boolean;
  dependsOn: readonly string[];
}

export const FEATURES = [
  { key: "import-url", label: "Import from URL", description: "Import a recipe from a web page.", default: true, dependsOn: [] },
  { key: "ingredient-parser", label: "Ingredient parser", description: "Split ingredient lines into quantity, unit and food.", default: true, dependsOn: [] },
  { key: "foods-units", label: "Foods and units", description: "A catalogue of foods and units, with merge.", default: true, dependsOn: ["ingredient-parser"] },
  { key: "scaling", label: "Scaling and conversion", description: "Scale servings and convert units.", default: true, dependsOn: [] },
  { key: "organizers", label: "Organisers", description: "Tags, categories and tools.", default: true, dependsOn: [] },
  { key: "cook-mode", label: "Cook mode", description: "One step at a time, large type, step timers.", default: true, dependsOn: [] },
  { key: "ratings", label: "Favourites and ratings", description: "Per-user favourites and ratings.", default: true, dependsOn: [] },
  { key: "meal-plan", label: "Meal planner", description: "Plan meals by day and week.", default: true, dependsOn: [] },
  { key: "shopping-lists", label: "Shopping lists", description: "Build and share shopping lists.", default: true, dependsOn: [] },
  { key: "cookbooks", label: "Cookbooks", description: "Saved filtered collections of recipes.", default: true, dependsOn: ["organizers"] },
  { key: "share-links", label: "Share links", description: "Public read-only links to a recipe.", default: true, dependsOn: [] },
  { key: "import-files", label: "Import from files", description: "Import from other apps and files.", default: true, dependsOn: [] },
  { key: "backups", label: "Export and backups", description: "Export recipes; back up and restore the instance.", default: true, dependsOn: [] },
  { key: "timeline", label: "Timeline and comments", description: "Record when you cooked a recipe, with notes and photos.", default: true, dependsOn: [] },
  { key: "nutrition", label: "Nutrition", description: "Nutrition facts per serving.", default: false, dependsOn: [] },
  { key: "print", label: "Print view", description: "A print-friendly recipe view.", default: true, dependsOn: [] },
  { key: "api-tokens", label: "API tokens", description: "Tokens for scripts.", default: true, dependsOn: [] },
  { key: "webhooks", label: "Webhooks", description: "Call a URL when events happen.", default: false, dependsOn: ["api-tokens"] },
  { key: "pwa", label: "Installable app", description: "Install as an app; recent recipes work offline.", default: true, dependsOn: [] },
  { key: "ai", label: "AI helpers", description: "Bring your own key for photo and text import.", default: false, dependsOn: [] },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

export type FeatureSource = "env" | "override" | "default" | "dependency";

export interface FeatureState {
  enabled: boolean;
  /** True when an environment variable fixes the value; the admin UI cannot change it. */
  locked: boolean;
  source: FeatureSource;
}

export type ResolvedFeatures = Record<FeatureKey, FeatureState>;

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

/** `meal-plan` becomes `MEALLY_FEATURE_MEAL_PLAN`. */
export function featureEnvVar(key: FeatureKey): string {
  return `MEALLY_FEATURE_${key.toUpperCase().replaceAll("-", "_")}`;
}

export interface ResolveInput {
  env?: Record<string, string | undefined>;
  overrides?: Partial<Record<string, boolean>>;
}

function parseEnv(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  return undefined;
}

/** Pure: env lock, then DB override, then default; then any disabled dependency switches the flag off. */
export function resolveFeatures({ env = {}, overrides = {} }: ResolveInput = {}): ResolvedFeatures {
  const out = {} as ResolvedFeatures;
  const byKey = new Map<string, FeatureDef>(FEATURES.map((f) => [f.key, f]));

  const resolve = (key: FeatureKey): FeatureState => {
    const done = out[key];
    if (done) return done;
    const def = byKey.get(key)!;
    const fromEnv = parseEnv(env[featureEnvVar(key)]);
    const override = overrides[key];
    const locked = fromEnv !== undefined;
    let state: FeatureState;
    if (fromEnv !== undefined) state = { enabled: fromEnv, locked, source: "env" };
    else if (typeof override === "boolean") state = { enabled: override, locked, source: "override" };
    else state = { enabled: def.default, locked, source: "default" };
    if (state.enabled && def.dependsOn.some((d) => !resolve(d as FeatureKey).enabled)) {
      state = { enabled: false, locked, source: "dependency" };
    }
    out[key] = state;
    return state;
  };
  for (const key of FEATURE_KEYS) resolve(key);
  return out;
}
