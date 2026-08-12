import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function normalizeLegacyPlainText(content: string) {
  if (content.length < 400 || /\n\s*\n|^#{1,6}\s|^[-*]\s|^\d+[.)]\s/m.test(content)) return content;
  const sentences = content.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.length < 4) return content;
  return Array.from({ length: Math.ceil(sentences.length / 3) }, (_, index) =>
    sentences
      .slice(index * 3, index * 3 + 3)
      .join(' ')
      .trim(),
  ).join('\n\n');
}

export function MarkdownContent({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={`markdown-content ${className}`} dir="ltr">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...(props as ComponentPropsWithoutRef<'table'>)} />
            </div>
          ),
          a: ({ node: _node, ...props }) => (
            <a
              {...(props as ComponentPropsWithoutRef<'a'>)}
              rel="noreferrer noopener"
              target="_blank"
            />
          ),
        }}
      >
        {normalizeLegacyPlainText(content)}
      </ReactMarkdown>
    </div>
  );
}
