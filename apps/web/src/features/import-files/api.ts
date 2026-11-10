import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "../../lib/api";

export interface ImportJob {
  id: string;
  format: "jsonld" | "recipesage" | "paprika" | "mealie" | "zip";
  filename: string | null;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ item: string; message: string }>;
  createdAt: number;
  finishedAt: number | null;
}

export const isFinished = (j?: ImportJob) => j?.status === "done" || j?.status === "failed";

/** Uploads with XMLHttpRequest because fetch cannot report upload progress. */
export function uploadImport(file: File, onProgress: (fraction: number) => void): Promise<ImportJob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/import/files");
    xhr.setRequestHeader("X-Requested-With", "meally");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiRequestError(0, "network", "The upload failed. Check your connection and try again."));
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as ImportJob);
      else reject(new ApiRequestError(xhr.status, body.error ?? "error", body.message ?? `Upload failed (${xhr.status})`));
    };
    const form = new FormData();
    form.set("file", file);
    xhr.send(form);
  });
}

/** Polls every second until the job finishes. */
export const useImportJob = (id: string | null) =>
  useQuery({
    queryKey: ["import-job", id],
    queryFn: () => api<ImportJob>(`/import/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isFinished(q.state.data) ? false : 1000),
  });

export const useImportJobs = () => useQuery({ queryKey: ["import-jobs"], queryFn: () => api<{ items: ImportJob[] }>("/import/jobs") });
