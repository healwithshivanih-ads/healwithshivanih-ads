/**
 * copyText — clipboard write that works in EVERY context the coach uses.
 *
 * navigator.clipboard exists only in secure contexts (https / localhost).
 * Opening the dashboard via the Mac's LAN address (http://192.168.x.x:3002)
 * left every 📋 Copy button silently dead (coach bug report 2026-06-12).
 * Falls back to the hidden-textarea execCommand trick.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
