"use client";
import { useState, useTransition } from "react";
import { applyImageFromUrl, RecipeImageStatus } from "./actions";

function SearchLink({ dish }: { dish: string }) {
  const q = encodeURIComponent(dish + " recipe indian food photo");
  return (
    <a
      href={`https://www.google.com/search?q=${q}&tbm=isch`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-blue-600 hover:underline"
    >
      🔍 Google Images ↗
    </a>
  );
}

function RecipeRow({ r, onDone }: { r: RecipeImageStatus; onDone: (slug: string, img: string) => void }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [isPending, startTransition] = useTransition();

  function apply() {
    if (!url.trim()) return;
    setStatus("loading");
    startTransition(async () => {
      const res = await applyImageFromUrl(r.slug, url.trim(), r.name);
      if (res.ok && res.img) {
        setStatus("ok");
        setMsg(`Score ${res.score}/5 — ${res.why}`);
        onDone(r.slug, res.img);
      } else {
        setStatus("err");
        setMsg(res.error || "Unknown error");
      }
    });
  }

  return (
    <div className="border rounded-lg p-4 flex gap-4 items-start">
      {/* thumb placeholder */}
      <div className="w-24 h-16 rounded bg-muted flex-shrink-0 overflow-hidden">
        {status === "ok" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={r.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🍽</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="font-medium text-sm">{r.name}</span>
          <span className="text-xs text-muted-foreground font-mono">{r.slug}</span>
          <SearchLink dish={r.name} />
        </div>

        {status === "ok" ? (
          <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">✓ Saved · {msg}</p>
        ) : (
          <div className="flex gap-2 items-center">
            <input
              type="url"
              placeholder="Paste direct image URL (.jpg / .png)…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              className="flex-1 text-xs border rounded px-2 py-1.5 bg-background"
            />
            <button
              onClick={apply}
              disabled={!url.trim() || status === "loading"}
              className="text-xs bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
            >
              {status === "loading" ? "Saving…" : "Apply"}
            </button>
          </div>
        )}
        {status === "err" && (
          <p className="text-xs text-red-600 mt-1">{msg}</p>
        )}
      </div>
    </div>
  );
}

function DoneRow({ r }: { r: RecipeImageStatus }) {
  const [replacing, setReplacing] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [currentImg, setCurrentImg] = useState(r.imageUrl);
  const [isPending, startTransition] = useTransition();

  function apply() {
    if (!url.trim()) return;
    setStatus("loading");
    startTransition(async () => {
      const res = await applyImageFromUrl(r.slug, url.trim(), r.name);
      if (res.ok && res.img) {
        setStatus("ok");
        setMsg(`Score ${res.score}/5 — ${res.why}`);
        setCurrentImg(res.img + "?t=" + Date.now());
        setReplacing(false);
      } else {
        setStatus("err");
        setMsg(res.error || "Unknown error");
      }
    });
  }

  return (
    <div className="border rounded-lg p-3 flex gap-3 items-center">
      {currentImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentImg} alt={r.name} className="w-20 h-14 object-cover rounded flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{r.name}</span>
          <span className="text-xs text-green-700">✓</span>
          {!replacing && (
            <button onClick={() => setReplacing(true)} className="text-xs text-muted-foreground hover:text-foreground ml-auto">
              Replace
            </button>
          )}
        </div>
        {r.sourceUrl && !replacing && (
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:underline truncate block max-w-xs">
            {r.sourceUrl}
          </a>
        )}
        {replacing && (
          <div className="flex gap-2 mt-1">
            <input type="url" placeholder="New image URL…" value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              className="flex-1 text-xs border rounded px-2 py-1 bg-background" />
            <button onClick={apply} disabled={!url.trim() || status === "loading"}
              className="text-xs bg-primary text-primary-foreground rounded px-2 py-1 disabled:opacity-50">
              {status === "loading" ? "…" : "Apply"}
            </button>
            <button onClick={() => setReplacing(false)} className="text-xs text-muted-foreground">Cancel</button>
          </div>
        )}
        {status === "err" && <p className="text-xs text-red-600 mt-1">{msg}</p>}
        {status === "ok" && <p className="text-xs text-green-700 mt-1">✓ {msg}</p>}
      </div>
    </div>
  );
}

export default function RecipeImagesClient({
  missing,
  done,
}: {
  missing: RecipeImageStatus[];
  done: RecipeImageStatus[];
}) {
  const [pendingList, setPendingList] = useState(missing);
  const [doneList, setDoneList] = useState(done);
  const [showDone, setShowDone] = useState(false);

  function handleDone(slug: string, img: string) {
    const rec = pendingList.find((r) => r.slug === slug);
    if (rec) {
      setPendingList((p) => p.filter((r) => r.slug !== slug));
      setDoneList((d) => [{ ...rec, hasWebImage: true, imageUrl: img }, ...d]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Missing images */}
      <section>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <span className="text-amber-600">⚠</span>
          Missing images ({pendingList.length})
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — find a photo, right-click → "Copy image address", paste below
          </span>
        </h2>
        {pendingList.length === 0 ? (
          <p className="text-sm text-green-700 bg-green-50 rounded p-4">All recipes have images 🎉</p>
        ) : (
          <div className="space-y-3">
            {pendingList.map((r) => (
              <RecipeRow key={r.slug} r={r} onDone={handleDone} />
            ))}
          </div>
        )}
      </section>

      {/* Done */}
      <section>
        <button
          onClick={() => setShowDone((v) => !v)}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {showDone ? "▾" : "▸"} {doneList.length} recipes with images
        </button>
        {showDone && (
          <div className="mt-3 space-y-2">
            {doneList.map((r) => (
              <DoneRow key={r.slug} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
