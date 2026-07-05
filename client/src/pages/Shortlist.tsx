import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ShortlistCandidate } from "../lib/types";
import { Navbar } from "../components/Navbar";

const AVAIL_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN_TO_WORK: { label: "Open to work", cls: "bg-green-500/15 text-green-400" },
  OPEN_TO_OFFERS: { label: "Open to offers", cls: "bg-amber-500/15 text-amber-400" },
  NOT_LOOKING: { label: "Not looking", cls: "bg-ink-700 text-mist-400" },
};

export default function Shortlist() {
  const [candidates, setCandidates] = useState<ShortlistCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ ok: true; shortlist: ShortlistCandidate[] }>("/api/shortlist");
      setCandidates(res.shortlist);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveNote(username: string) {
    await api("/api/shortlist", { method: "POST", body: JSON.stringify({ username, note: noteDraft }) });
    setCandidates((prev) => prev.map((c) => (c.username === username ? { ...c, note: noteDraft } : c)));
    setEditingNote(null);
  }

  async function remove(username: string) {
    if (!confirm("Remove this candidate from your shortlist?")) return;
    await api(`/api/shortlist/${username}`, { method: "DELETE" });
    setCandidates((prev) => prev.filter((c) => c.username !== username));
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Saved Candidates</h1>
          <p className="mt-1 text-sm text-mist-400">
            Your shortlist of developers, with private notes only you can see.
          </p>
        </div>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading...</p>}

        {!loading && candidates.length === 0 && (
          <div className="card !p-8 text-center">
            <p className="font-semibold">No saved candidates yet</p>
            <p className="mt-1 text-sm text-mist-400">
              Find developers in <Link to="/talent" className="text-brand-400 hover:underline">Talent Search</Link> and save them here.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {candidates.map((c) => {
            const badge = c.availability ? AVAIL_BADGE[c.availability] : null;
            return (
              <div key={c.id} className="card">
                <div className="flex items-start gap-3">
                  <Link to={`/u/${c.username}`} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 font-bold">
                    {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" /> : c.displayName[0]?.toUpperCase()}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/u/${c.username}`} className="font-semibold hover:underline">{c.displayName}</Link>
                    <p className="text-xs text-mist-600">@{c.username}</p>
                    {c.headline && <p className="mt-0.5 truncate text-sm text-mist-400">{c.headline}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {c.specialty && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-brand-400">{c.specialty}</span>}
                      {c.yearsExperience !== null && <span className="text-mist-400">{c.yearsExperience}y exp</span>}
                      {badge && <span className={"rounded-full px-2 py-0.5 font-semibold " + badge.cls}>{badge.label}</span>}
                    </div>
                  </div>
                  <button onClick={() => remove(c.username)} className="shrink-0 text-sm text-mist-600 hover:text-red-400" aria-label="Remove">✕</button>
                </div>

                {/* الملاحظات */}
                <div className="mt-3 border-t border-ink-700 pt-3">
                  {editingNote === c.username ? (
                    <div className="space-y-2">
                      <textarea
                        className="input-field min-h-20 resize-y text-sm"
                        placeholder="Private notes about this candidate..."
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingNote(null)} className="btn-ghost !py-1.5 text-sm">Cancel</button>
                        <button onClick={() => saveNote(c.username)} className="btn-primary !py-1.5 text-sm">Save note</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingNote(c.username); setNoteDraft(c.note ?? ""); }}
                      className="w-full text-left text-sm"
                    >
                      {c.note ? (
                        <p className="whitespace-pre-wrap text-mist-100">📝 {c.note}</p>
                      ) : (
                        <span className="text-mist-600 hover:text-brand-400">+ Add a note</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
