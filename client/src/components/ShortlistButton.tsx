import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Star } from "lucide-react";

// زرار حفظ المرشح في الـ shortlist — للـ recruiters بس
export function ShortlistButton({ username }: { username: string }) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ ok: true; saved: boolean }>(`/api/shortlist/check/${username}`)
      .then((r) => setSaved(r.saved))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  async function toggle() {
    setBusy(true);
    try {
      if (saved) {
        await api(`/api/shortlist/${username}`, { method: "DELETE" });
        setSaved(false);
      } else {
        await api("/api/shortlist", { method: "POST", body: JSON.stringify({ username }) });
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={
        "inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 " +
        (saved ? "border border-amber-500/40 bg-amber-500/10 text-amber-400" : "bg-brand-500 text-white hover:bg-brand-600")
      }
    >
      <Star size={15} className={saved ? "fill-current" : ""} /> {saved ? "Saved" : "Save to shortlist"}
    </button>
  );
}
