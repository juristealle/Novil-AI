import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import remarkBreaks from "remark-breaks";
import { CollapsibleCodeBlock } from "./components/CollapsibleCodeBlock";

type Props = {
  content: string;
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => <h2>{children}</h2>,
          h3: ({ children }) => <h3>{children}</h3>,

          p: ({ children }) => <p>{children}</p>,

          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,

          blockquote: ({ children }) => <blockquote>{children}</blockquote>,

          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),

          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const code = String(children).replace(/\n$/, "");
            const language = match ? match[1] : "";

            if (match) {
              return <CollapsibleCodeBlock language={language} code={code} />;
            }

            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          },

          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
