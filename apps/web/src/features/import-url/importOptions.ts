import { useFeature } from "../features/FeaturesProvider";

export type ImportSource = "link" | "text" | "photos";

export interface ImportOption {
  source: ImportSource;
  label: string;
  to: string;
}

const ALL: ImportOption[] = [
  { source: "link", label: "Import from a link", to: "/recipes/import" },
  { source: "text", label: "Import from text", to: "/recipes/import?from=text" },
  { source: "photos", label: "Import from photos", to: "/recipes/import?from=photos" },
];

/** Reads `?from=` so menu entries can open the matching tab. Unknown values fall back to the link tab. */
export function importSource(params: URLSearchParams): ImportSource {
  const from = params.get("from");
  return from === "text" || from === "photos" ? from : "link";
}

/** The import entry points to show, one per source, so each label says what it does. */
export function useImportOptions(): ImportOption[] {
  const canImport = useFeature("import-url");
  const ai = useFeature("ai");
  if (!canImport) return [];
  return ai ? ALL : ALL.slice(0, 1);
}
