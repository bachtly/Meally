import { Search } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const DEBOUNCE_MS = 250;

/** Desktop search field: filters the library by keeping the query in `?q=`. */
export const HeaderSearch = forwardRef<HTMLInputElement>(function HeaderSearch(_props, ref) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const onLibrary = pathname === "/recipes";
  const urlQ = onLibrary ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQ);

  // Follow the URL (back button, cleared search).
  useEffect(() => setValue(urlQ), [urlQ]);

  useEffect(() => {
    if (value === urlQ) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(onLibrary ? params : undefined);
      if (value.trim()) next.set("q", value);
      else next.delete("q");
      const qs = next.toString();
      navigate(`/recipes${qs ? `?${qs}` : ""}`, { replace: onLibrary });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, urlQ, onLibrary, params, navigate]);

  return (
    <form role="search" className="relative hidden w-full max-w-md lg:block" onSubmit={(e) => e.preventDefault()}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search recipes"
        placeholder="Search recipes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-11 w-full rounded-md border border-line bg-raised pl-9 pr-16 text-base text-ink placeholder:text-muted"
      />
      <kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-xs text-muted">
        Ctrl K
      </kbd>
    </form>
  );
});
