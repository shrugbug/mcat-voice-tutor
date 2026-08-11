import katex from 'katex';
import 'katex/contrib/mhchem';

export interface MathSegment {
  type: 'text' | 'math';
  value: string;
  display: boolean;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && /\d/.test(char);
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Scans a complete numeric price token starting at `start`. Returns the index
 * immediately after the token, or `start` if there is no number.
 *
 * Accepted forms:
 * - one or more digits
 * - digits followed by `,ddd` thousand separators, repeated
 * - any of the above followed by `.d+` decimal part
 */
function readNumberTokenEnd(text: string, start: number): number {
  const n = text.length;
  let i = start;

  while (i < n && isDigit(text[i])) i++;
  if (i === start) return start;

  while (
    i + 4 <= n &&
    text[i] === ',' &&
    isDigit(text[i + 1]) &&
    isDigit(text[i + 2]) &&
    isDigit(text[i + 3])
  ) {
    i += 4;
  }

  if (i < n && text[i] === '.' && i + 1 < n && isDigit(text[i + 1])) {
    i++;
    while (i < n && isDigit(text[i])) i++;
  }

  return i;
}

/**
 * Single-pass LaTeX delimiter parser.
 *
 * Rules:
 * - Escaped `\$`, `\{`, `\}` are literals.
 * - `$$` is preferred over `$` (match $$ before $).
 * - A `$` inside braces `{...}` is a literal, not a delimiter.
 * - A `$` immediately followed by a complete numeric price token and then a
 *   whitespace is a literal dollar/currency sign, not math.
 * - An inline `$...$` may not span a newline.
 * - Display `$$...$$` may still span newlines, and closes on the rightmost `$$`
 *   in a run so that `$$$x$$$` stays a single display block with no stray `$`.
 * - An unmatched opener falls back to literal text.
 */
export function renderMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const n = text.length;
  let i = 0;
  let plain = '';

  function flushPlain() {
    if (plain) {
      segments.push({ type: 'text', value: plain, display: false });
      plain = '';
    }
  }

  while (i < n) {
    // Escaped dollar or brace: literal.
    if (text[i] === '\\' && i + 1 < n && (text[i + 1] === '$' || text[i + 1] === '{' || text[i + 1] === '}')) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (text[i] === '$') {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i + 1 < n ? text[i + 1] : '';

      // Display math opening: $$ token, not the second $ of another $$.
      if (next === '$' && prev !== '$') {
        flushPlain();
        const start = i + 2;
        const close = findDisplayClose(text, start);
        if (close !== -1) {
          segments.push({ type: 'math', value: text.slice(start, close).trim(), display: true });
          i = close + 2;
          continue;
        }
        plain += '$$';
        i += 2;
        continue;
      }

      // Inline math opening: single $ not part of a $$ run.
      if (next !== '$' && prev !== '$') {
        // Currency boundary: $ followed by a complete numeric price token and then
        // whitespace is a literal price, not math.
        const numberEnd = readNumberTokenEnd(text, i + 1);
        if (numberEnd > i + 1 && isWhitespace(text[numberEnd])) {
          plain += '$';
          i++;
          continue;
        }

        const close = findInlineClose(text, i + 1);
        if (close !== -1) {
          const value = text.slice(i + 1, close);
          flushPlain();
          segments.push({ type: 'math', value: value.trim(), display: false });
          i = close + 1;
          continue;
        }
      }

      // Literal $ (unmatched or rejected).
      plain += '$';
      i++;
      continue;
    }

    plain += text[i];
    i++;
  }

  flushPlain();
  return segments.length > 0 ? segments : [{ type: 'text', value: text, display: false }];
}

function findDisplayClose(text: string, start: number): number {
  let braceDepth = 0;
  const n = text.length;
  let i = start;

  while (i < n) {
    if (text[i] === '\\' && i + 1 < n && (text[i + 1] === '$' || text[i + 1] === '{' || text[i + 1] === '}')) {
      i += 2;
      continue;
    }

    if (text[i] === '{') {
      braceDepth++;
    } else if (text[i] === '}') {
      braceDepth--;
    } else if (
      braceDepth === 0 &&
      text[i] === '$' &&
      i + 1 < n &&
      text[i + 1] === '$' &&
      (i + 2 >= n || text[i + 2] !== '$')
    ) {
      // Found a rightmost $$ token in a run of $s.
      return i;
    }

    i++;
  }

  return -1;
}

function findInlineClose(text: string, start: number): number {
  let braceDepth = 0;
  const n = text.length;
  let i = start;

  while (i < n) {
    // Inline math may not span a newline.
    if (text[i] === '\n') return -1;

    if (text[i] === '\\' && i + 1 < n && (text[i + 1] === '$' || text[i + 1] === '{' || text[i + 1] === '}')) {
      i += 2;
      continue;
    }

    if (text[i] === '{') {
      braceDepth++;
    } else if (text[i] === '}') {
      braceDepth--;
    } else if (
      braceDepth === 0 &&
      text[i] === '$' &&
      (i + 1 >= n || text[i + 1] !== '$') &&
      (i === 0 || text[i - 1] !== '$')
    ) {
      return i;
    }

    i++;
  }

  return -1;
}

/**
 * throwOnError: false -- malformed model output degrades to visible source rather than blanking
 * the panel. trust: false -- blocks \href and \htmlClass, which would otherwise be an injection
 * path through dangerouslySetInnerHTML.
 */
export function renderToHtml(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
  });
}

export default function MathText({ text }: { text: string }) {
  const segments = renderMathSegments(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <span
            key={index}
            dangerouslySetInnerHTML={{ __html: renderToHtml(segment.value, segment.display) }}
          />
        )
      )}
    </>
  );
}
