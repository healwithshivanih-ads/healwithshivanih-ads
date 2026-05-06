import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function plansRoot(): string {
  const env = process.env.FMDB_PLANS_DIR;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), "fm-plans");
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const clientId = form.get("clientId");
    const file = form.get("file");

    if (typeof clientId !== "string" || !clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const stored = `${today}-${file.name}`;
    const dir = path.join(plansRoot(), "clients", clientId, "files");
    await fs.mkdir(dir, { recursive: true });

    // Deduplicate filename
    const ext = path.extname(stored);
    const stem = path.basename(stored, ext);
    let target = path.join(dir, stored);
    let n = 2;
    while (true) {
      try {
        await fs.access(target);
        target = path.join(dir, `${stem}-${n}${ext}`);
        n++;
      } catch {
        break;
      }
    }

    const bytes = await file.arrayBuffer();
    await fs.writeFile(target, Buffer.from(bytes));

    return NextResponse.json({ ok: true, filePath: target });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
