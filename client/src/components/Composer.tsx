import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { Post, PostType } from "../lib/types";
import { Code2, HelpCircle, ImagePlus, Plus, X } from "lucide-react";
import { useRef } from "react";
import { useAuth } from "../lib/auth";

export function Composer({
  onCreated,
  endpoint = "/api/posts",
  placeholder,
}: {
  onCreated: (post: Post) => void;
  endpoint?: string;
  placeholder?: string;
}) {
  const { user } = useAuth();
  const [type, setType] = useState<PostType>("TEXT");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("");
  const [codeContent, setCodeContent] = useState("");
  const [wantsHelp, setWantsHelp] = useState(false);
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
          ? { type, title: title || undefined, body, codeLanguage: codeLanguage.trim(), codeContent, wantsHelp, imageUrl: imageUrl ?? undefined }
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
      setCodeLanguage("");
      setWantsHelp(false);
      setImageUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  // زرار نوع البوست في الصف السفلي — الضغط تاني بيرجّع لبوست عادي
  const typeBtn = (t: PostType, label: string, Icon: typeof Code2) => (
    <button
      type="button"
      onClick={() => setType(type === t ? "TEXT" : t)}
      className={
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors " +
        (type === t
          ? "bg-brand-500/15 text-brand-400"
          : "text-mist-400 hover:bg-ink-900 hover:text-mist-100")
      }
      aria-pressed={type === t}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="card !p-4">
      {/* صف الكتابة: الأفاتار + الحقول — زي الديزاين */}
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500 font-bold text-white">
          {user?.profile.avatarUrl ? (
            <img src={user.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            user?.profile.displayName?.[0]?.toUpperCase() ?? "?"
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            className="input-field !border-transparent !bg-transparent !px-0 !py-1 text-[15px] font-semibold focus:!border-transparent"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          <textarea
            className="input-field min-h-16 resize-y"
            placeholder={placeholder ?? (type === "QUESTION" ? "What's blocking you?" : "What are you building today?")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
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
          <input
            className="input-field !w-auto text-sm"
            value={codeLanguage}
            onChange={(e) => setCodeLanguage(e.target.value)}
            placeholder="Language (e.g. typescript)"
            aria-label="Snippet language"
            maxLength={30}
            spellCheck={false}
          />
          <textarea
            className="input-field min-h-32 resize-y font-mono text-sm"
            placeholder={"async function* walk(dir: string) {\n  // paste your code here\n}"}
            value={codeContent}
            onChange={(e) => setCodeContent(e.target.value)}
            spellCheck={false}
          />
          {/* البوست ده طالب مساعدة على الكود؟ — بيعرض بادج Help Wanted في الفيد */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-mist-400">
            <input
              type="checkbox"
              checked={wantsHelp}
              onChange={(e) => setWantsHelp(e.target.checked)}
              className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-brand-500 focus:ring-brand-500"
            />
            <HelpCircle size={14} /> I need help with this code
          </label>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* الصف السفلي: أنواع البوست + المرفقات شمال، زر النشر يمين — زي الديزاين */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-700/50 pt-3">
        <div className="flex flex-wrap items-center gap-1">
          {typeBtn("SNIPPET", "Snippet", Code2)}
          {imageUploadEnabled && (
            <>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-mist-400 hover:bg-ink-900 hover:text-mist-100 disabled:opacity-50"
                title="Attach image"
              >
                <ImagePlus size={15} /> {uploadingImage ? "Uploading..." : "Image"}
              </button>
            </>
          )}
          {typeBtn("PROJECT", "Project", Plus)}
          {typeBtn("QUESTION", "Question", HelpCircle)}
        </div>
        <button
          onClick={submit}
          disabled={submitting || !body.trim() || (type === "SNIPPET" && (!codeContent.trim() || !codeLanguage.trim()))}
          className="btn-primary !px-6 !py-2 text-sm disabled:opacity-50"
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </div>
    </div>
  );
}
