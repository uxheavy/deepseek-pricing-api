import canonicalize from "canonicalize";

export function canonicalJSON(value: unknown): string {
  const result = canonicalize(value);

  if (result === undefined) {
    throw new Error("The value cannot be represented as canonical JSON.");
  }

  return result;
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = new Uint8Array(source);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function canonicalHash(value: unknown): Promise<string> {
  return sha256(canonicalJSON(value));
}
