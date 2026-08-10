'use client';

import { sanitizeHtml } from '@/lib/sanitize';

export type DisplayContent = {
  html: string;
  kind: 'passage' | 'question' | 'diagram' | 'feedback' | string;
};

type Props = {
  content: DisplayContent | null;
};

/**
 * Left 2/3 of the layout. Renders `show_content` tool-call payloads.
 * `dangerouslySetInnerHTML` is only ever fed the output of `sanitizeHtml`
 * (strict allowlist, all attributes stripped) -- never the raw model HTML.
 */
export default function ContentPanel({ content }: Props) {
  if (!content) {
    return (
      <section className="content-panel content-panel--empty">
        <p className="content-panel__placeholder">
          Content the examiner shows you (passages, question options, diagrams) will appear here.
        </p>
      </section>
    );
  }

  const safeHtml = sanitizeHtml(content.html);
  const kindClass = `content-panel--${content.kind}`;

  return (
    <section className={`content-panel ${kindClass}`}>
      <span className="content-panel__kind">{content.kind}</span>
      {/* html is passed through sanitizeHtml's strict allowlist above before reaching here */}
      <div className="content-panel__body" dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </section>
  );
}
