/**
 * Strict allowlist HTML sanitizer for `show_content` output.
 *
 * This is a real, single-pass tag tokenizer, not a regex. It is quote-aware,
 * so a `>` inside a quoted attribute does not end a tag, and it never treats
 * attribute values or tag names as text nodes. The tokenizer is safe to use in
 * both the browser and in the Node test runner.
 *
 * Behavior:
 * - Tags not in the allowlist are unwrapped (tag dropped, inner text kept).
 * - `<script>`/`<style>` are dropped along with their entire content.
 * - All attributes are stripped from every tag, allowed or not.
 * - The scan is linear: a `<` that cannot start a tag advances the index past
 *   it in constant time; a run of unmatched `<` characters is never rescanned.
 */

const ALLOWED_TAGS = new Set([
  'p', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'sub', 'sup',
  'b', 'i', 'em', 'strong', 'br', 'h3', 'h4', 'code', 'pre',
]);

const VOID_TAGS = new Set(['br']);

// Tags whose entire content (including nested tags) must be discarded.
const DROP_CONTENT_TAGS = new Set(['script', 'style']);

type TagToken = { name: string; isClosing: boolean; selfClosing: boolean };

type TagResult =
  | { kind: 'tag'; token: TagToken; next: number }
  | { kind: 'skip'; next: number }
  | { kind: 'text'; next: number; noMoreTags: boolean };

function readTag(s: string, i: number): TagResult {
  const n = s.length;

  // Lone `<` at the end of the string cannot be a tag and there is nothing
  // after it to rescan, so the remaining work is all text.
  if (i + 1 >= n) {
    return { kind: 'text', next: n, noMoreTags: true };
  }

  // HTML comment.
  if (s[i + 1] === '!' && s[i + 2] === '-' && s[i + 3] === '-') {
    const end = s.indexOf('-->', i + 4);
    return { kind: 'skip', next: end === -1 ? n : end + 3 };
  }

  // CDATA section.
  if (s[i + 1] === '!' && i + 9 <= n && s.slice(i, i + 9).toLowerCase() === '<![cdata[') {
    const end = s.indexOf(']]>', i + 9);
    return { kind: 'skip', next: end === -1 ? n : end + 3 };
  }

  // DOCTYPE or other declaration.
  if (s[i + 1] === '!') {
    const end = s.indexOf('>', i + 1);
    return { kind: 'skip', next: end === -1 ? n : end + 1 };
  }

  // XML processing instruction.
  if (s[i + 1] === '?') {
    const end = s.indexOf('?>', i + 1);
    return { kind: 'skip', next: end === -1 ? n : end + 2 };
  }

  let j = i + 1;
  let isClosing = false;
  if (s[j] === '/') {
    isClosing = true;
    j++;
    if (j >= n) {
      return { kind: 'text', next: n, noMoreTags: true };
    }
  }

  // A tag-like construct starts with a non-whitespace character that is not `>`.
  // The name continues until the first whitespace, quote, or `>` so that even
  // invalid tag names such as `$x$` are recognised as tag constructs and are not
  // processed as text nodes (which protects math inside them).
  if (s[j] === '>' || /\s/.test(s[j])) {
    return { kind: 'text', next: i + 1, noMoreTags: false };
  }

  let k = j;
  while (k < n && !/\s|>|'|"/.test(s[k])) k++;
  const name = s.slice(j, k).toLowerCase();

  // Scan to the matching `>` or `/>`, respecting single and double quotes.
  let inSingle = false;
  let inDouble = false;
  let l = k;
  while (l < n) {
    const c = s[l];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (c === '>') {
        return { kind: 'tag', token: { name, isClosing, selfClosing: false }, next: l + 1 };
      }
      if (c === '/' && l + 1 < n && s[l + 1] === '>') {
        return { kind: 'tag', token: { name, isClosing, selfClosing: true }, next: l + 2 };
      }
    }
    l++;
  }

  // No matching `>` was found. The entire remainder of the string cannot
  // contain a tag, so we mark it as all text and stop rescanning.
  return { kind: 'text', next: n, noMoreTags: true };
}

function isVoidTag(name: string): boolean {
  return VOID_TAGS.has(name);
}

function isDropContentTag(name: string): boolean {
  return DROP_CONTENT_TAGS.has(name);
}

function isAllowedTag(name: string): boolean {
  return ALLOWED_TAGS.has(name);
}

/**
 * Parse `html` and render each text node through `renderText`. Tag names,
 * attributes, and the contents of `<script>`/`<style>` are never passed to
 * `renderText`. The scan is linear in the length of the input.
 */
export function renderSanitizedHtml(html: string, renderText: (text: string) => string): string {
  const n = html.length;
  let i = 0;
  let out = '';
  let textStart = 0;
  let drop: { tag: string; depth: number } | null = null;

  while (i < n) {
    if (html[i] === '<') {
      const tagResult = readTag(html, i);

      if (tagResult.kind === 'text') {
        if (tagResult.noMoreTags) {
          // No `>` exists from this position onward. Flush the remaining text
          // in one call and end the scan so we never rescan the suffix.
          if (!drop) out += renderText(html.slice(textStart, n));
          break;
        }
        // Not a tag; treat the `<` as part of the current text run.
        i = tagResult.next;
        continue;
      }

      // Flush the text that came before this tag.
      if (i > textStart) {
        const text = html.slice(textStart, i);
        if (!drop) out += renderText(text);
      }

      if (tagResult.kind === 'tag') {
        const { token } = tagResult;

        if (drop) {
          // While inside a drop-content element, only the matching closing
          // tag changes the drop depth. Everything else is discarded.
          if (token.name === drop.tag) {
            if (token.isClosing) drop.depth--;
            else drop.depth++;
            if (drop.depth <= 0) drop = null;
          }
        } else {
          if (isDropContentTag(token.name) && !token.isClosing) {
            drop = { tag: token.name, depth: 1 };
          } else if (isAllowedTag(token.name)) {
            if (isVoidTag(token.name)) {
              out += `<${token.name}/>`;
            } else if (token.isClosing) {
              out += `</${token.name}>`;
            } else if (token.selfClosing) {
              // Non-void self-closing tags are still emitted as an opening
              // tag; the browser (and the original regex sanitizer) treats
              // them the same way.
              out += `<${token.name}>`;
            } else {
              out += `<${token.name}>`;
            }
          }
          // Unknown tags are unwrapped: their children continue through
          // renderText.
        }
      }

      textStart = tagResult.next;
      i = tagResult.next;
      continue;
    }

    i++;
  }

  // Flush remaining text (only reached if we did not hit noMoreTags).
  if (textStart < n) {
    const text = html.slice(textStart, n);
    if (!drop) out += renderText(text);
  }

  return out;
}

export function sanitizeHtml(html: string): string {
  return renderSanitizedHtml(html, (text) => text);
}
