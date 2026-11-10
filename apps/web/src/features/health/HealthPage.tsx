import { useQuery } from "@tanstack/react-query";
import { appName } from "@meally/shared";
import { api } from "../../lib/api";

export function HealthPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ ok: boolean; version: string }>("/health"),
  });

  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-semibold">{appName}</h1>
      {isPending && <p>Checking server...</p>}
      {isError && <p role="alert">Server is unreachable.</p>}
      {data && <p>Server is up, version {data.version}.</p>}
    </main>
  );
}
