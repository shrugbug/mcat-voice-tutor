import { describe, expect, test } from 'vitest';
import { sanitizeHtml } from '../lib/sanitize';

describe('sanitizeHtml', () => {
  test('strips script tags along with their content', () => {
    const input = '<p>hi</p><script>alert("pwned")</script><p>bye</p>';
    expect(sanitizeHtml(input)).toBe('<p>hi</p><p>bye</p>');
  });

  test('strips style tags along with their content', () => {
    const input = '<style>body{color:red}</style><p>ok</p>';
    expect(sanitizeHtml(input)).toBe('<p>ok</p>');
  });

  test('keeps allowed tags from the brief allowlist', () => {
    const input =
      '<p>para</p><ul><li>a</li></ul><ol><li>b</li></ol>' +
      '<table><tr><th>h</th><td>d</td></tr></table>' +
      '<sub>s</sub><sup>t</sup><b>b</b><i>i</i><em>e</em><strong>st</strong>' +
      '<br><h3>h3</h3><h4>h4</h4><code>c</code><pre>p</pre>';
    expect(sanitizeHtml(input)).toBe(
      '<p>para</p><ul><li>a</li></ul><ol><li>b</li></ol>' +
        '<table><tr><th>h</th><td>d</td></tr></table>' +
        '<sub>s</sub><sup>t</sup><b>b</b><i>i</i><em>e</em><strong>st</strong>' +
        '<br/><h3>h3</h3><h4>h4</h4><code>c</code><pre>p</pre>'
    );
  });

  test('strips all attributes from allowed tags, including event handlers, style, and href', () => {
    const input = '<p onclick="evil()" style="color:red" href="javascript:evil()">text</p>';
    expect(sanitizeHtml(input)).toBe('<p>text</p>');
  });

  test('unwraps unknown tags, dropping the tag but keeping inner text', () => {
    const input = '<div class="x">hello <span>world</span></div>';
    expect(sanitizeHtml(input)).toBe('hello world');
  });

  test('drops img entirely (no text content to preserve)', () => {
    const input = '<p>before</p><img src="x.png" onerror="evil()"><p>after</p>';
    expect(sanitizeHtml(input)).toBe('<p>before</p><p>after</p>');
  });

  test('unwraps anchor tags, stripping href but keeping link text', () => {
    const input = '<a href="https://evil.example">click me</a>';
    expect(sanitizeHtml(input)).toBe('click me');
  });

  test('handles plain text with no tags', () => {
    expect(sanitizeHtml('just text')).toBe('just text');
  });
});
