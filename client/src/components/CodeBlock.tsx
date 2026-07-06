import { useMemo } from "react";
// core build + اللغات اللي محتاجينها بس — عشان الـ bundle ما يتضخمش
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml"; // html
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);

export function CodeBlock({ code, language }: { code: string; language: string }) {
  // useMemo عشان ما نعملش highlight تاني مع كل render
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      // لغة مش متسجلة؟ نعرض الكود plain بدل ما التطبيق يقع
      return code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  }, [code, language]);

  return (
    <div className="overflow-hidden rounded-lg border border-ink-700">
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-3 py-1.5">
        <span className="font-mono text-xs uppercase tracking-wider text-brand-400">{language}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(code)}
          className="text-xs text-mist-400 hover:text-mist-100"
        >
          Copy
        </button>
      </div>
      <pre className="code-surface overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
