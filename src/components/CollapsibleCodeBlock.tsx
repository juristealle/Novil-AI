import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  language: string;
  code: string;
}

export function CollapsibleCodeBlock({ language, code }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const displayLabel = language
    ? `📄 ${language.toUpperCase()} Code`
    : `📄 Code Block`;

  return (
    <div className="collapsible-code-wrapper">
      <button className="code-reveal-btn" onClick={() => setIsOpen(!isOpen)}>
        <span className="code-icon">{displayLabel}</span>
        <span className="code-toggle">{isOpen ? "▲ Hide" : "▼ View"}</span>
      </button>

      {isOpen && (
        <div className="code-expanded">
          <div className="code-header">
            <span>{language || "text"}</span>
            <button onClick={copyCode} className="copy-button">
              {copied ? "Copied!" : "Copy code"}
            </button>
          </div>
          <SyntaxHighlighter
            language={language || "text"}
            style={oneDark}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "12px",
              background: "#010f22",
              fontSize: "13px",
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
