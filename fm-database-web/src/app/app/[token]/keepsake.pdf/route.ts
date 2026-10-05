/**
 * /app/<token>/keepsake.pdf — the recipe keepsake as a real PDF file.
 *
 * The HTML keepsake page relies on window.print(), which does nothing inside an
 * installed iOS home-screen app (Krittika, 2026-10-05). This returns an actual
 * download so it works on any device. Same data as the page (data.recipePack).
 */

import { cookies } from "next/headers";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { loadClientAppData } from "@/lib/fmdb/client-app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FOREST = rgb(0.176, 0.353, 0.239);
const OCHRE = rgb(0.69, 0.482, 0.118);
const INK = rgb(0.173, 0.165, 0.141);
const MUTED = rgb(0.435, 0.416, 0.365);

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const BODY_W = PAGE_W - MARGIN * 2;

/** Standard PDF fonts are WinAnsi-only — map common glyphs, drop the rest. */
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/[•·]/g, "-")
    .replace(/\s/g, " ")
    .replace(/[^\x20-\x7E\u00A1-\u00FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of clean(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data = null;
  try {
    const deviceTz = (await cookies()).get("ochre_tz")?.value ?? null;
    data = await loadClientAppData(token, { deviceTz });
  } catch (err) {
    console.error("[keepsake.pdf] failed to assemble app data:", err);
  }
  if (!data) return new Response("This keepsake link is no longer active.", { status: 404 });

  const recipes = data.recipePack ?? [];
  const firstName = data.client?.firstName ?? "";
  const coachName = data.coach?.name ?? "The Ochre Tree";

  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensure = (h: number) => {
    if (y - h < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const centered = (text: string, font: PDFFont, size: number, color = INK) => {
    const t = clean(text);
    page.drawText(t, { x: (PAGE_W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };
  const para = (text: string, font: PDFFont, size: number, color = INK, indent = 0, prefix = "") => {
    const lines = wrap(text, font, size, BODY_W - indent - (prefix ? 16 : 0));
    lines.forEach((ln, i) => {
      ensure(size * 1.4);
      y -= size * 1.4;
      if (i === 0 && prefix) page.drawText(prefix, { x: MARGIN + indent, y, size, font, color });
      page.drawText(ln, { x: MARGIN + indent + (prefix ? 16 : 0), y, size, font, color });
    });
  };

  // Cover
  y -= 30;
  centered("THE OCHRE TREE", serifBold, 11, OCHRE);
  y -= 34;
  centered(firstName ? `${firstName}'s Recipe Keepsake` : "Your Recipe Keepsake", serifBold, 26, FOREST);
  y -= 22;
  centered("The recipes from your healing journey - yours to keep, cook and share.", serifItalic, 11.5, MUTED);
  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: OCHRE });
  y -= 10;

  if (recipes.length === 0) {
    y -= 30;
    centered("No recipes to gather yet.", serif, 12, MUTED);
  }

  for (const r of recipes) {
    ensure(90);
    y -= 26;
    para(r.title, serifBold, 16, FOREST);
    const meta = [r.serves, r.time].filter(Boolean).join("  -  ");
    if (meta) para(meta, serifBold, 10.5, OCHRE);
    y -= 4;
    para("INGREDIENTS", serifBold, 9, MUTED);
    for (const ing of r.ingredients) para(ing, serif, 11, INK, 4, "-");
    y -= 4;
    para("METHOD", serifBold, 9, MUTED);
    r.method.forEach((m, j) => para(m, serif, 11, INK, 4, `${j + 1}.`));
    if (r.tip) {
      y -= 3;
      para(`Tip - ${r.tip}`, serifItalic, 10.5, MUTED);
    }
    y -= 6;
    ensure(10);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: MUTED, opacity: 0.4 });
  }

  y -= 30;
  ensure(30);
  centered(`With care, ${coachName} - The Ochre Tree`, serifItalic, 11, MUTED);

  const bytes = await pdf.save();
  const fileName = `${(firstName || "My").replace(/[^A-Za-z0-9]/g, "")}-Recipe-Keepsake.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
