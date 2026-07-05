import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------
// عرض نص بصيغة Markdown بشكل آمن ومنسّق
// جمهورنا مبرمجين، فبيستخدموا **bold** و `code` و lists و links
// ما بنسمحش بـ HTML خام (react-markdown آمن افتراضيًا ضد الـ XSS)
// ---------------------------------------------------------------
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-devconnect">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // الروابط تفتح في تاب جديد بأمان
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" className="text-brand-400 hover:underline" />
          ),
          // كود inline
          code: ({ node, className, children, ...props }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg bg-ink-900 p-3 font-mono text-sm text-mist-100" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-sm text-brand-400" {...props}>
                {children}
              </code>
            );
          },
          ul: ({ node, ...props }) => <ul className="my-2 ml-5 list-disc space-y-1" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-2 border-l-2 border-brand-500/50 pl-3 text-mist-400" {...props} />
          ),
          h1: ({ node, ...props }) => <h1 className="mb-1 mt-2 text-lg font-bold" {...props} />,
          h2: ({ node, ...props }) => <h2 className="mb-1 mt-2 text-base font-bold" {...props} />,
          h3: ({ node, ...props }) => <h3 className="mb-1 mt-2 font-semibold" {...props} />,
          p: ({ node, ...props }) => <p className="my-1 leading-relaxed" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
