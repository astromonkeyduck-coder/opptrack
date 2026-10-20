import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase documents both legacy 400 and current named 409 duplicate errors. */
export function isDuplicateObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; statusCode?: string | number; code?: string; message?: string };
  const numeric = Number(value.status ?? value.statusCode);
  if (Number.isFinite(numeric) && numeric !== 400 && numeric !== 409) return false;
  return numeric === 409 || [value.code, String(value.statusCode)].some(code => code === "ResourceAlreadyExists" || code === "KeyAlreadyExists") ||
    (numeric === 400 && /^(?:the resource|asset) already exists[.!]?$/i.test(value.message?.trim() ?? ""));
}

/** A duplicate response alone cannot establish that the immutable bytes match. */
export async function verifyStoredObject(client: SupabaseClient, path: string, expectedHash: string, expectedBytes: number) {
  const { data, error } = await client.storage.from("captures").download(path);
  if (error || !data || data.size !== expectedBytes) throw new Error("Existing private object could not be verified; no facts were committed");
  const actual = createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex");
  if (actual !== expectedHash) throw new Error("Existing private object hash differs; no facts were committed");
}
