import { renderSanitizedHtml } from '@/lib/sanitize';
import type { ViewSpec } from '@/lib/views';
import MathText, { renderMathSegments, renderToHtml } from './MathText';

type Props = Extract<ViewSpec, { component: 'passage' }>;

function escapeHtml(text: string): string {
  return text
    .replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPassageText(text: string): string {
  if (!text.includes('$')) return escapeHtml(text);

  return renderMathSegments(text)
    .map((segment) =>
      segment.type === 'text' ? escapeHtml(segment.value) : renderToHtml(segment.value, segment.display)
    )
    .join('');
}

/**
 * Renders math in the text nodes of a sanitized passage HTML string.
 *
 * A real tag tokenizer is used so math is never processed inside tag names,
 * attribute names, or attribute values. Script and event-handler attributes
 * are still removed by the sanitizer.
 */
export function renderPassageHtml(html: string): string {
  return renderSanitizedHtml(html, renderPassageText);
}

export default function PassageView({ html, title }: Props) {
  return (
    <article className="view passage-view">
      {title && <h2 className="view__title"><MathText text={title} /></h2>}
      <div className="passage-view__body" dangerouslySetInnerHTML={{ __html: renderPassageHtml(html) }} />
    </article>
  );
}
