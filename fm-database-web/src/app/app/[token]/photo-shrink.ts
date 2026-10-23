/**
 * Shrink a photo on the phone before uploading — shared by the chat and the
 * food diary so both send the same thing.
 *
 * A modern phone camera produces 3–6 MB per shot. On Indian mobile data
 * that is a slow upload the client watches fail, and it is the single
 * biggest lever on what photo features cost to run — roughly ten times.
 * Canvas re-encoding also drops EXIF, so the GPS coordinates of someone's
 * kitchen never leave their phone. The server strips it again; neither
 * side trusts the other to have done it.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
  // If the browser refuses to encode, send the original rather than
  // nothing — the server will shrink it anyway.
  return blob ?? file;
}
