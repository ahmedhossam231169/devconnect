import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

// شريط البحث في الـ topbar — مش realtime:
// بيكتب في الخانة ولما يدوس Enter أو زرار العدسة بيفتح صفحة /search
export function SearchBar() {
  const [params] = useSearchParams();
  // لو احنا أصلاً في صفحة نتايج البحث نبدأ بنفس الكلمة اللي في الرابط
  const [q, setQ] = useState(params.get("q") ?? "");
  const navigate = useNavigate();

  function submit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return; // نفس حد الـ backend
    navigate(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <form onSubmit={submit} role="search" className="relative hidden w-full max-w-md flex-1 lg:block">
      {/* خانة الـ pill + زرار عدسة على الشمال بيبعت الفورم */}
      <button
        type="submit"
        aria-label="Search"
        title="Search"
        className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-mist-600 transition-colors hover:bg-ink-700 hover:text-mist-100"
      >
        <Search size={16} />
      </button>
      <input
        className="w-full rounded-full border border-transparent bg-ink-800 py-2 pl-11 pr-4 text-sm text-mist-100 placeholder:text-mist-600 focus:border-brand-500 focus:outline-none"
        placeholder="Search developers, posts, communities..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search"
      />
    </form>
  );
}
