/**
 * Strict allowlist HTML sanitizer for `show_content` output.
 *
 * Deviation from the brief: the brief suggests a "DOMParser allowlist
 * walker." DOMParser is browser-only and this project's test runner
 * (vitest, node environment, no jsdom dependency available -- adding one
 * would violate the "no new deps" constraint) has no DOM globals. A
 * hand-rolled tag tokenizer gives identical behavior in the browser and in
 * tests without any DOM dependency, so this is a pure string -> string
 * function safe to unit test directly.
 *
 * Behavior:
 * - Tags not in the allowlist are unwrapped (tag dropped, inner text kept).
 * - `<script>`/`<style>` are dropped along with their entire content (not
 *   just unwrapped), since their text is not safe to surface as prose.
 * - All attributes are stripped from every tag, allowed or not.
 */

const ALLOWED_TAGS = new Set([
  'p', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'sub', 'sup',
  'b', 'i', 'em', 'strong', 'br', 'h3', 'h4', 'code', 'pre',
]);

const VOID_TAGS = new Set(['br']);

// Tags whose entire content (including nested tags) must be discarded.
const DROP_CONTENT_TAGS = new Set(['script', 'style']);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

export function sanitizeHtml(html: string): string {
  let out = '';
  let lastIndex = 0;
  let skipTag: string | null = null;
  let skipDepth = 0;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html))) {
    const [full, rawTag] = match;
    const tag = rawTag.toLowerCase();
    const isClosing = full.startsWith('</');
    const textBefore = html.slice(lastIndex, match.index);
    lastIndex = TAG_RE.lastIndex;

    if (skipTag) {
      if (tag === skipTag) {
        if (isClosing) skipDepth -= 1;
        else skipDepth += 1;
        if (skipDepth <= 0) skipTag = null;
      }
      continue; // drop text and tags while inside a dropped-content element
    }

    out += textBefore;

    if (DROP_CONTENT_TAGS.has(tag) && !isClosing) {
      skipTag = tag;
      skipDepth = 1;
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      continue; // unwrap: drop the tag, keep surrounding text
    }

    if (VOID_TAGS.has(tag)) {
      out += `<${tag}/>`;
    } else {
      out += isClosing ? `</${tag}>` : `<${tag}>`;
    }
  }
  out += html.slice(lastIndex);
  return out;
}
