import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Post, PostType } from "../lib/types";
import { PenLine, Code2, HelpCircle, Sparkles, ImagePlus, X } from "lucide-react";
import { useRef } from "react";

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const imageUploadEnabled = !!(CLOUD_NAME && UPLOAD_PRESET);

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5MB"); return; }
    setError(null);
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", UPLOAD_PRESET ?? "");
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!data.secure_url) throw new Error();
      setImageUrl(data.secure_url);
    } catch {
      setError("Image upload failed — try again");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload =
        type === "SNIPPET"
          ? { type, title: title || undefined, body, codeLanguage, codeContent, imageUrl: imageUrl ?? undefined }
          : { type, title: title || undefined, body, imageUrl: imageUrl ?? undefined };

      const res = await api<{ ok: true; post: Post }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      onCreated(res.post);
      // نفضّي الفورم بعد النشر
      setTitle("");
      setBody("");
      setCodeContent("");
      setImageUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  const tab = (t: PostType, label: string, Icon: typeof PenLine) => (
    <button
      type="button"
      onClick={() => setType(t)}
      className={
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors " +
        (type === t ? "bg-brand-500 text-white" : "text-mist-400 hover:text-mist-100")
      }
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="card !p-4">
      <div className="mb-3 flex gap-1 rounded-lg bg-ink-900 p-1">
        {tab("TEXT", "Post", PenLine)}
        {tab("SNIPPET", "Snippet", Code2)}
        {tab("QUESTION", "Question", HelpCircle)}
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
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs text-mist-600">
          <Sparkles size={12} /> Markdown supported — **bold**, `code`, lists, and [links](url)
        </p>
        {imageUploadEnabled && (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-mist-400 hover:bg-ink-900 hover:text-brand-400 disabled:opacity-50"
              title="Attach image"
            >
              <ImagePlus size={15} /> {uploadingImage ? "Uploading..." : "Image"}
            </button>
          </>
        )}
      </div>

      {/* معاينة الصورة المرفوعة */}
      {imageUrl && (
        <div className="relative mt-2 inline-block">
          <img src={imageUrl} alt="" className="max-h-48 rounded-lg border border-ink-700 object-cover" />
          <button
            type="button"
            onClick={() => setImageUrl(null)}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink-800 text-mist-100 shadow hover:bg-red-500 hover:text-white"
            aria-label="Remove image"
          >
            <X size={13} />
          </button>
        </div>
      )}
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
