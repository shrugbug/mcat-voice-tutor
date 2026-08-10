import { sanitizeHtml } from '@/lib/sanitize';
import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'passage' }>;

export default function PassageView({ html, title }: Props) {
  const safeHtml = sanitizeHtml(html);

  return (
    <article className="view passage-view">
      {title && <h2 className="view__title">{title}</h2>}
      <div className="passage-view__body" dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </article>
  );
}
