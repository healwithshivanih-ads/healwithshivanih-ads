/**
 * Upload a file to a client's files dir via the /api/upload-client-file Route
 * Handler — the safe path for binary uploads of any size.
 *
 * WHY NOT a Server Action: a File passed to a Server Action is serialized by
 * React Flight, whose deserializer enforces a cumulative array/buffer-slot limit
 * (1e6). A file's byteLength is counted (and reference-forked, often doubling
 * it), so a ~1 MB upload throws "Maximum array nesting exceeded" on the server
 * BEFORE the action body runs — the file never saves and the caller sees a
 * generic server error. Small files slip under the limit, which is why this only
 * bit large PDFs (multi-page lab reports, DUTCH/GI-MAP, genetic reports).
 *
 * Route handlers parse FormData natively with no such limit. Returns the saved
 * absolute path; throws on failure so existing try/catch around the old
 * uploadFileAction call keeps working unchanged.
 */
export async function uploadClientFile(
  clientId: string,
  file: File,
): Promise<string> {
  const fd = new FormData();
  fd.append("clientId", clientId);
  fd.append("file", file);
  const res = await fetch("/api/upload-client-file", {
    method: "POST",
    body: fd,
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; filePath?: string; error?: string }
    | null;
  if (!res.ok || !json?.ok || !json.filePath) {
    throw new Error(json?.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return json.filePath;
}
