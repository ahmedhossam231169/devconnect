import { useState, useRef } from "react";
import { FileText, X } from "lucide-react";

// ---------------------------------------------------------------
// رفع ملف (PDF أساسًا — للـ resume) لـ Cloudinary مباشرة (unsigned)
// بنستخدم endpoint الـ auto عشان يقبل ملفات مش صور
// نفس متغيرات البيئة بتاعة ImageUpload
// ---------------------------------------------------------------

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export function FileUpload({
  currentUrl,
  onUploaded,
  onCleared,
  label = "Upload PDF",
  accept = "application/pdf",
  maxMB = 10,
}: {
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  onCleared?: () => void;
  label?: string;
  accept?: string;
  maxMB?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(currentUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  const configured = CLOUD_NAME && UPLOAD_PRESET;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxMB * 1024 * 1024) {
      setError(`File must be under ${maxMB}MB`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", UPLOAD_PRESET ?? "");
      // auto = يقبل أي نوع ملف (PDF, docs...) مش الصور بس
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.secure_url) throw new Error("Upload failed");
      setUrl(data.secure_url);
      onUploaded(data.secure_url);
    } catch {
      setError("Upload failed — try again");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (!configured) {
    return <p className="text-xs text-mist-600">File upload isn't configured yet.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <input ref={inputRef} type="file" accept={accept} onChange={handleFile} className="hidden" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-ghost !py-2 text-sm disabled:opacity-60"
        >
          <FileText size={15} /> {uploading ? "Uploading..." : label}
        </button>
        {url && (
          <span className="flex items-center gap-2 text-sm text-mist-400">
            <a href={url} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
              View current
            </a>
            {onCleared && (
              <button
                type="button"
                onClick={() => { setUrl(null); onCleared(); }}
                className="text-mist-600 hover:text-red-400"
                aria-label="Remove file"
              >
                <X size={14} />
              </button>
            )}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
