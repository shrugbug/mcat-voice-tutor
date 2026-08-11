import { describe, expect, test } from 'vitest';
import { renderPassageHtml } from '../app/components/views/PassageView';

describe('renderPassageHtml', () => {
  test('renders a formula inside a <p>', () => {
    const out = renderPassageHtml('<p>Reaction: $\\ce{H2SO4 -> H+ + HSO4-}$</p>');
    expect(out).toContain('<p>Reaction: ');
    expect(out).toContain('</p>');
    expect(out).not.toContain('$\\\\ce');
    expect(out).not.toContain('\\\\ce');
    expect(out).toContain('katex');
    expect(out).toContain('SO');
  });

  test('still applies the sanitizer', () => {
    const out = renderPassageHtml('<script>alert("pwn")</script><p>Hello $x$</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<p>Hello ');
    expect(out).toContain('</p>');
    expect(out).toContain('katex');
    expect(out).not.toContain('$x$');
  });

  test('preserves allowed HTML structure', () => {
    const out = renderPassageHtml('<ul><li>Item 1</li><li>$a + b$</li></ul>');
    expect(out).toContain('<ul><li>Item 1</li><li>');
    expect(out).toContain('</li></ul>');
    expect(out).toContain('katex');
  });

  test('does not render math inside tag names or attributes', () => {
    const out = renderPassageHtml('<p data-math="$x$">text</p>');
    expect(out).toBe('<p>text</p>');
  });

  test('is quote-aware and does not render math inside a quoted attribute', () => {
    const out = renderPassageHtml('<p title="before > $x$ after">text</p>');
    expect(out).toBe('<p>text</p>');
    expect(out).not.toContain('before');
    expect(out).not.toContain('after');
    expect(out).not.toContain('katex');
  });

  test('does not render math inside tag-like names with $', () => {
    const out = renderPassageHtml('<$x$>TAG_SENTINEL</$x$>');
    expect(out).toBe('TAG_SENTINEL');
    expect(out).not.toContain('katex');
  });

  test('skips CDATA sections terminated by ]]', () => {
    const out = renderPassageHtml('<p>before<![CDATA[ a > $x$ ]]>after</p>');
    expect(out).toBe('<p>beforeafter</p>');
    expect(out).not.toContain('katex');
  });

  test(
    'does not suffer quadratic blowup on many unmatched < signs',
    { timeout: 30000 },
    () => {
      const size = 50000;
      const input = '<'.repeat(size) + ' some text';
      const start = Date.now();
      const out = renderPassageHtml(input);
      const duration = Date.now() - start;
      expect(out).toContain('&lt;');
      expect(out).toContain(' some text');
      expect(duration).toBeLessThan(1000);
    }
  );
});
