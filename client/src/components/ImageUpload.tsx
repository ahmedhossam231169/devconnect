import { useState, useRef } from "react";
import { Camera } from "lucide-react";

// ---------------------------------------------------------------
// رفع صورة لـ Cloudinary مباشرة من المتصفح (unsigned upload)
// مش بتعدّي على السيرفر بتاعنا — أسرع وأخف
//
// محتاج متغيرين في الـ .env بتاع الـ client:
//   VITE_CLOUDINARY_CLOUD_NAME
//   VITE_CLOUDINARY_UPLOAD_PRESET  (unsigned preset)
// ---------------------------------------------------------------

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export function ImageUpload({
  currentUrl,
  onUploaded,
  label = "Upload image",
  rounded = true,
}: {
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  label?: string;
  rounded?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  const configured = CLOUD_NAME && UPLOAD_PRESET;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // تحقق بسيط: نوع وحجم
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", UPLOAD_PRESET ?? "");

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.secure_url) throw new Error("Upload failed");

      setPreview(data.secure_url);
      onUploaded(data.secure_url);
    } catch {
      setError("Upload failed — try again");
    } finally {
      setUploading(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-xs text-mist-600">
        Image upload isn't configured yet.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className={
          "flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-ink-700 " +
          (rounded ? "rounded-full" : "rounded-xl")
        }
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera size={24} className="text-mist-600" />
        )}
      </div>
      <div>
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-ghost !py-2 text-sm disabled:opacity-60"
        >
          {uploading ? "Uploading..." : label}
        </button>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        <p className="mt-1 text-xs text-mist-600">JPG, PNG or GIF · max 5MB</p>
      </div>
    </div>
  );
}
