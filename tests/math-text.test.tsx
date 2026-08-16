import { describe, expect, test } from 'vitest';
import { renderMathSegments, renderToHtml } from '../app/components/views/MathText';

describe('renderMathSegments', () => {
  test('passes prose through untouched', () => {
    expect(renderMathSegments('just words')).toEqual([{ type: 'text', value: 'just words', display: false }]);
  });

  test('splits inline math out of surrounding prose', () => {
    expect(renderMathSegments('rate is $k[A]$ here')).toEqual([
      { type: 'text', value: 'rate is ', display: false },
      { type: 'math', value: 'k[A]', display: false },
      { type: 'text', value: ' here', display: false },
    ]);
  });

  test('recognises display math', () => {
    expect(renderMathSegments('$$E=mc^2$$')).toEqual([{ type: 'math', value: 'E=mc^2', display: true }]);
  });

  test('leaves a lone unmatched delimiter as literal text', () => {
    // Model output is unreliable; an unbalanced $ must not swallow the rest of the string.
    expect(renderMathSegments('costs $5 today')).toEqual([
      { type: 'text', value: 'costs $5 today', display: false },
    ]);
  });

  test('does not pair a currency $ with a later inline math delimiter', () => {
    expect(renderMathSegments('costs $5 today then $x$ is velocity and rest remains')).toEqual([
      { type: 'text', value: 'costs $5 today then ', display: false },
      { type: 'math', value: 'x', display: false },
      { type: 'text', value: ' is velocity and rest remains', display: false },
    ]);
  });

  test('renders math that begins with a digit and contains spaces', () => {
    expect(renderMathSegments('$5x + 3$')).toEqual([{ type: 'math', value: '5x + 3', display: false }]);
  });

  test('treats multi-digit and decimal currency as literal', () => {
    expect(renderMathSegments('costs $5 today then $x$ is velocity')).toEqual([
      { type: 'text', value: 'costs $5 today then ', display: false },
      { type: 'math', value: 'x', display: false },
      { type: 'text', value: ' is velocity', display: false },
    ]);
    expect(renderMathSegments('$1,234.56 and $y$')).toEqual([
      { type: 'text', value: '$1,234.56 and ', display: false },
      { type: 'math', value: 'y', display: false },
    ]);
    expect(renderMathSegments('$5x + 3$')).toEqual([{ type: 'math', value: '5x + 3', display: false }]);
  });

  test('unmatched inline $ never spans a newline', () => {
    const out = renderMathSegments('question $unclosed\nNext paragraph has $x$ and conclusion');
    expect(out).toEqual([
      { type: 'text', value: 'question $unclosed\nNext paragraph has ', display: false },
      { type: 'math', value: 'x', display: false },
      { type: 'text', value: ' and conclusion', display: false },
    ]);
  });

  test('does not split math around dollar signs inside braces', () => {
    expect(renderMathSegments('prefix $\\ce{H$^{+}$ + Cl-}$ suffix')).toEqual([
      { type: 'text', value: 'prefix ', display: false },
      { type: 'math', value: '\\ce{H$^{+}$ + Cl-}', display: false },
      { type: 'text', value: ' suffix', display: false },
    ]);
  });

  test('handles triple-dollar runs as display math with no stray', () => {
    expect(renderMathSegments('$$$x$$$')).toEqual([{ type: 'math', value: '$x$', display: true }]);
  });

  test('treats escaped dollar signs as literal', () => {
    expect(renderMathSegments('price is \\$5 and $x$ is a var')).toEqual([
      { type: 'text', value: 'price is $5 and ', display: false },
      { type: 'math', value: 'x', display: false },
      { type: 'text', value: ' is a var', display: false },
    ]);
  });
});

describe('renderToHtml', () => {
  test('renders chemistry via mhchem', () => {
    const html = renderToHtml('\\ce{H2SO4}', false);
    expect(html).toContain('katex');
    expect(html).toContain('SO');
  });

  test('degrades malformed input to visible source instead of throwing', () => {
    expect(() => renderToHtml('\\frac{', false)).not.toThrow();
    expect(renderToHtml('\\frac{', false)).toContain('katex');
  });

  test('does not emit an anchor for \\href — trust is disabled', () => {
    const html = renderToHtml('\\href{https://evil.example}{click}', false);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="https://evil.example"');
  });
});
