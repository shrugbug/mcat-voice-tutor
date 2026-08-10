'use client';

import { sanitizeHtml } from '@/lib/sanitize';
import type { ViewSpec } from '@/lib/views';
import { renderView } from './views';

export type DisplayContent = {
  html: string;
  kind: 'passage' | 'question' | 'diagram' | 'feedback' | string;
};

type Props = {
  content: DisplayContent | null;
  view: ViewSpec | null;
};

/**
 * Left 2/3 of the layout. Renders the active registered view, falling back to
 * legacy `show_content` tool-call payloads.
 * `dangerouslySetInnerHTML` is only ever fed the output of `sanitizeHtml`
 * (strict allowlist, all attributes stripped) -- never the raw model HTML.
 */
export default function ContentPanel({ content, view }: Props) {
  if (view) {
    return <section className="content-panel view-panel">{renderView(view)}</section>;
  }

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
