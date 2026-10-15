import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function requireId(value: string): void {
  if (!Types.ObjectId.isValid(value)) throw new HttpError(400, "Invalid resource ID.");
}
export function notFound(res: Response, message = "Resource not found.") {
  return res.status(404).json({ error: message });
}
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const e = err as { status?: number; message?: string; name?: string };
  if (e?.name === "ValidationError") return res.status(400).json({ error: e.message || "Validation failed." });
  if (e?.name === "CastError") return res.status(400).json({ error: "Invalid ID or value." });
  if (e?.name === "MulterError") return res.status(e.message?.includes("File too large") ? 413 : 400).json({ error: e.message || "Invalid upload." });
  const status = typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status >= 500) console.error("API error:", err);
  return res.status(status).json({ error: status >= 500 ? "Something went wrong. Please try again." : (e.message || "Request failed.") });
}
