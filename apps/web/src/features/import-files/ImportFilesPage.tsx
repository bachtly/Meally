import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { ApiRequestError } from "../../lib/api";
import { Button, Card, Skeleton } from "../../ui";
import { isFinished, uploadImport, useImportJob, useImportJobs, type ImportJob } from "./api";

const FORMAT_LABEL: Record<ImportJob["format"], string> = {
  jsonld: "Recipe JSON (schema.org)",
  paprika: "Paprika",
  mealie: "Mealie",
  zip: "Zip of recipe pages",
};
const MAX_MB = 200;

function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted">{pct}%</p>
    </div>
  );
}

function Summary({ job }: { job: ImportJob }) {
  const done = isFinished(job);
  return (
    <div className="flex flex-col gap-3">
      {!done && <Bar label="Import progress" value={job.total ? (job.imported + job.skipped + job.failed) / job.total : 0} />}
      <p role="status" className="font-medium">
        {job.status === "failed" ? "The import failed." : done ? "Import finished." : job.status === "queued" ? "Waiting to start..." : "Importing..."}
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <li>Imported: {job.imported}</li>
        <li>Skipped (already in your library): {job.skipped}</li>
        <li>Errors: {job.failed}</li>
        <li className="text-muted">Total found: {job.total}</li>
      </ul>
      {job.errors.length > 0 && (
        <details className="rounded-md border border-line p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Show errors ({job.failed})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {job.errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.item}</span>: <span className="text-muted">{e.message}</span>
              </li>
            ))}
          </ul>
          {job.failed > job.errors.length && <p className="mt-2 text-sm text-muted">Showing the first {job.errors.length}.</p>}
        </details>
      )}
      {done && job.imported > 0 && (
        <Link to="/recipes" className="inline-flex min-h-11 items-center text-accent underline">
          View recipes
        </Link>
      )}
    </div>
  );
}

export function ImportFilesPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useImportJob(jobId);
  const jobs = useImportJobs();
  const finished = isFinished(job.data);
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: ["import-jobs"] });
  }, [finished, qc]);

  async function start(file: File | undefined) {
    if (!file) return;
    setError(null);
    setJobId(null);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That file is over ${MAX_MB} MB.`);
    setProgress(0);
    try {
      const created = await uploadImport(file, setProgress);
      setJobId(created.id);
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "The upload failed.");
    } finally {
      setProgress(null);
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void start(e.dataTransfer.files[0]);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link to="/settings" className="text-sm text-accent underline">
          Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Import recipes</h1>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? "border-accent bg-raised" : "border-line"}`}
      >
        <UploadCloud aria-hidden className="size-8 text-muted" />
        <p>Drop a file here, or choose one.</p>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Recipe file"
          accept=".json,.html,.htm,.zip,.paprikarecipes"
          onChange={(e) => {
            void start(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={progress !== null}>
          Choose file
        </Button>
        <p className="text-sm text-muted">Up to {MAX_MB} MB.</p>
      </div>

      {progress !== null && <Bar label="Upload progress" value={progress} />}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {job.data && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{job.data.filename ?? "Import"}</h2>
          <Summary job={job.data} />
        </Card>
      )}

      <section aria-labelledby="supported" className="flex flex-col gap-2">
        <h2 id="supported" className="text-lg font-semibold">
          What you can import
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            <strong>Paprika:</strong> choose Export in Paprika, then upload the .paprikarecipes file. Photos come along.
          </li>
          <li>
            <strong>Mealie:</strong> upload the zip from a Mealie export. Tags, categories and photos are kept.
          </li>
          <li>
            <strong>RecipeSage and other JSON:</strong> upload a .json file that holds one recipe or a list of them (schema.org format).
          </li>
          <li>
            <strong>A zip of pages:</strong> a zip of saved .html pages or .json files. Meally reads the recipe from each one.
          </li>
        </ul>
        <p className="text-sm text-muted">Recipes already in your library with the same name and source link are skipped.</p>
      </section>

      <section aria-labelledby="recent" className="flex flex-col gap-2">
        <h2 id="recent" className="text-lg font-semibold">
          Recent imports
        </h2>
        {jobs.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : jobs.isError ? (
          <p className="text-sm text-red-700 dark:text-red-400">Could not load recent imports.</p>
        ) : jobs.data.items.length === 0 ? (
          <p className="text-sm text-muted">Nothing imported yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.data.items.map((j) => (
              <li key={j.id} className="flex flex-col rounded-md border border-line p-3 text-sm">
                <span className="font-medium">{j.filename ?? FORMAT_LABEL[j.format]}</span>
                <span className="text-muted">
                  {FORMAT_LABEL[j.format]} · {new Date(j.createdAt).toLocaleString()} · {isFinished(j) ? j.status : "in progress"} · {j.imported}{" "}
                  imported, {j.skipped} skipped, {j.failed} errors
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
