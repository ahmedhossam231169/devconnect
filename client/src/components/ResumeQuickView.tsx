import { useEffect } from "react";
import { Download, ExternalLink, X } from "lucide-react";

// ---------------------------------------------------------------
// Quick View للـ CV — زي Quick Look في الأيفون:
// بيفتح الـ PDF في overlay جوه الصفحة عشان تشوفه من غير ما تنزّله.
// بيتقفل بالضغط برّه، أو زرار X، أو مفتاح Escape.
// ---------------------------------------------------------------
export function ResumeQuickView({
  url,
  filename = "resume.pdf",
  onClose,
}: {
  url: string;
  filename?: string;
  onClose: () => void;
}) {
  // قفل بـ Escape + منع تمرير الصفحة اللي ورا الـ overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Resume preview"
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* شريط علوي: اسم الملف + تحميل / فتح في تاب + إغلاق */}
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-700 px-4 py-2.5">
          <span className="truncate text-sm font-semibold text-mist-100">{filename}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-mist-400 hover:bg-ink-900 hover:text-mist-100"
              title="Open in new tab"
            >
              <ExternalLink size={15} /> <span className="hidden sm:inline">Open</span>
            </a>
            <a
              href={url}
              download={filename}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-mist-400 hover:bg-ink-900 hover:text-mist-100"
              title="Download"
            >
              <Download size={15} /> <span className="hidden sm:inline">Download</span>
            </a>
            <button
              onClick={onClose}
              className="flex items-center rounded-lg p-1.5 text-mist-400 hover:bg-ink-900 hover:text-mist-100"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* الـ PDF نفسه — بياخد باقي المساحة */}
        <iframe
          src={url}
          title="Resume preview"
          className="min-h-0 w-full flex-1 bg-white"
        />
      </div>
    </div>
  );
}
