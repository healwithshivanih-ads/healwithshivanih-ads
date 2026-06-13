"use client";
import { useState, useTransition } from "react";
import { applyImageFromUrl, RecipeImageStatus } from "./actions";

function SearchLink({ dish, ingredients }: { dish: string; ingredients: string[] }) {
  const q = encodeURIComponent(dish + (ingredients.length ? " " + ingredients.slice(0, 2).join(" ") : "") + " recipe");
  return (
    <a
      href={`https://www.google.com/search?q=${q}&tbm=isch`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
    >
      🔍 Google Images ↗
    </a>
  );
}

function RecipeRow({ r, onDone }: { r: RecipeImageStatus; onDone: (slug: string, img: string) => void }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
      {/* thumb / preview */}
      <div className="w-28 h-20 rounded bg-muted flex-shrink-0 overflow-hidden border">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={r.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">🍽</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {/* name + search link */}
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="font-semibold text-sm">{r.name}</span>
          <SearchLink dish={r.name} ingredients={r.mainIngredients} />
        </div>

        {/* one-line description */}
        {r.oneLine && (
          <p className="text-xs text-muted-foreground mb-1 leading-snug">{r.oneLine}</p>
        )}

        {/* key ingredients */}
        {r.mainIngredients.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {r.mainIngredients.map((ing) => (
              <span key={ing} className="text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                {ing}
              </span>
            ))}
          </div>
        )}

        {status === "ok" ? (
          <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">✓ Saved · {msg}</p>
        ) : (
          <div className="flex gap-2 items-center">
            <input
              type="url"
              placeholder="Right-click image → Copy image address → paste here"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreview(e.target.value.startsWith("http") ? e.target.value : null);
              }}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              className="flex-1 text-xs border rounded px-2 py-1.5 bg-background min-w-0"
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
  const [, startTransition] = useTransition();

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
        {r.oneLine && !replacing && (
          <p className="text-xs text-muted-foreground">{r.oneLine}</p>
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
        <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
          <span className="text-amber-600">⚠</span>
          {pendingList.length} recipes need images
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Click "🔍 Google Images" → find a clear photo of the finished dish → right-click → "Copy image address" → paste in the field → Apply
        </p>
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
          {showDone ? "▾" : "▸"} {doneList.length} recipes already have images
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
