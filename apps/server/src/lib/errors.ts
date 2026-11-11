import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 501 | 502 | 503 | 504,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status);
  if (err instanceof HTTPException) return c.json({ error: "http_error", message: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal_error", message: "Something went wrong" }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json({ error: "not_found", message: "Not found" }, 404);
