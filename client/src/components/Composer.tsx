import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Post, PostType } from "../lib/types";

const LANGUAGES = [
  "javascript", "typescript", "python", "rust", "go",
  "java", "csharp", "cpp", "php", "ruby", "sql", "bash", "json", "css", "html",
];

export function Composer({
  onCreated,
  endpoint = "/api/posts",
  placeholder,
}: {
  onCreated: (post: Post) => void;
  endpoint?: string;
  placeholder?: string;
}) {
  const [type, setType] = useState<PostType>("TEXT");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("typescript");
  const [codeContent, setCodeContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload =
        type === "SNIPPET"
          ? { type, title: title || undefined, body, codeLanguage, codeContent }
          : { type, title: title || undefined, body };

      const res = await api<{ ok: true; post: Post }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      onCreated(res.post);
      // نفضّي الفورم بعد النشر
      setTitle("");
      setBody("");
      setCodeContent("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  const tab = (t: PostType, label: string) => (
    <button
      type="button"
      onClick={() => setType(t)}
      className={
        "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors " +
        (type === t ? "bg-brand-500 text-white" : "text-mist-400 hover:text-mist-100")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="card !p-4">
      <div className="mb-3 flex gap-1 rounded-lg bg-ink-900 p-1">
        {tab("TEXT", "✍️ Post")}
        {tab("SNIPPET", "</> Snippet")}
        {tab("QUESTION", "❓ Question")}
      </div>

      <input
        className="input-field mb-2"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
      />
      <textarea
        className="input-field min-h-20 resize-y"
        placeholder={placeholder ?? (type === "QUESTION" ? "What's blocking you?" : "What are you building today?")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <p className="mt-1 text-xs text-mist-600">
        ✨ Markdown supported — **bold**, `code`, lists, and [links](url)
      </p>
      {type === "SNIPPET" && (
        <div className="mt-2 space-y-2">
          <select
            className="input-field !w-auto text-sm"
            value={codeLanguage}
            onChange={(e) => setCodeLanguage(e.target.value)}
            aria-label="Snippet language"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <textarea
            className="input-field min-h-32 resize-y font-mono text-sm"
            placeholder={"async function* walk(dir: string) {\n  // paste your code here\n}"}
            value={codeContent}
            onChange={(e) => setCodeContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={submit}
          disabled={submitting || !body.trim() || (type === "SNIPPET" && !codeContent.trim())}
          className="btn-primary !py-2 text-sm disabled:opacity-50"
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </div>
    </div>
  );
}
