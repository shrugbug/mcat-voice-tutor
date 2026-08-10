'use client';

// Deterministic render harness for every render_view component, with stress
// cases. Exists so UI issues reported from live voice sessions (which QA
// automation cannot summon) can be reproduced and eyeballed without a session.
// Reachable only behind the deployment's auth wall; no data access.

import { ViewSpecSchema, type ViewSpec } from '@/lib/views';
import { renderView } from '../../components/views';

const CASES: { label: string; spec: unknown }[] = [
  {
    label: 'data_table — typical (3×4)',
    spec: {
      component: 'data_table',
      props: {
        title: 'Enzyme inhibition comparison',
        headers: ['Type', 'Km', 'Vmax'],
        rows: [
          ['Competitive', 'increases', 'unchanged'],
          ['Noncompetitive', 'unchanged', 'decreases'],
          ['Uncompetitive', 'decreases', 'decreases'],
          ['Mixed', 'varies', 'decreases'],
        ],
      },
    },
  },
  {
    label: 'data_table — stress: 8 cols × 30 rows, long unbroken cell',
    spec: {
      component: 'data_table',
      props: {
        title: 'Wide table stress',
        headers: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        rows: Array.from({ length: 30 }, (_, i) => [
          `row ${i + 1}`,
          'supercalifragilisticexpialidociouslyunbrokenstringthatmustnotforcehorizontalpagescroll',
          'ΔG = ΔH − TΔS',
          `${i * 3.14}`,
          'CH3(CH2)16COOH',
          'medium length cell content here',
          'x',
          'end',
        ]),
      },
    },
  },
  {
    label: 'data_table — single row, single-char cells',
    spec: {
      component: 'data_table',
      props: { headers: ['Q'], rows: [['A']] },
    },
  },
  {
    label: 'answer_grid — unrevealed',
    spec: {
      component: 'answer_grid',
      props: {
        options: [
          'Increases Km, Vmax unchanged',
          'Decreases Vmax, Km unchanged',
          'A distractor that is deliberately much longer than the others to test wrapping behavior inside lettered option rows at narrow widths',
          'Both decrease',
        ],
        revealed: false,
      },
    },
  },
  {
    label: 'answer_grid — revealed, correct C',
    spec: {
      component: 'answer_grid',
      props: {
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        revealed: true,
        correctIndex: 2,
      },
    },
  },
  {
    label: 'flashcard_deck — 3 cards',
    spec: {
      component: 'flashcard_deck',
      props: {
        title: 'Amino acids',
        cards: [
          { front: 'Which amino acids are positively charged at physiological pH?', back: 'Lysine, Arginine, Histidine (partially)' },
          { front: 'pKa of a carboxylic acid side chain (Asp/Glu)?', back: '~4' },
          { front: 'Start codon amino acid?', back: 'Methionine (AUG)' },
        ],
      },
    },
  },
  {
    label: 'timer — running 90s',
    spec: { component: 'timer', props: { seconds: 90, label: 'CARS passage', running: true } },
  },
  {
    label: 'mastery_chart — 8 categories',
    spec: {
      component: 'mastery_chart',
      props: {
        categories: [
          { id: '4A', name: 'Translational motion, forces, work, energy', mastery: 0.38 },
          { id: '4C', name: 'Electrochemistry and circuits', mastery: 0.45 },
          { id: '5A', name: 'Unique nature of water and aqueous solutions', mastery: 0.52 },
          { id: '6B', name: 'Sensory processing', mastery: 0.61 },
          { id: '1A', name: 'Structure and function of proteins', mastery: 0.7 },
          { id: '7A', name: 'Individual influences on behavior', mastery: 0.77 },
          { id: '9B', name: 'Demographic characteristics and processes', mastery: 0.83 },
          { id: '3A', name: 'Nervous and endocrine systems', mastery: 0.9 },
        ],
      },
    },
  },
  {
    label: 'passage — with allowed markup',
    spec: {
      component: 'passage',
      props: {
        title: 'Passage I',
        html: '<p>A buffer contains H<sub>2</sub>PO<sub>4</sub><sup>-</sup> and HPO<sub>4</sub><sup>2-</sup>.</p><table><tr><th>Species</th><th>pKa</th></tr><tr><td>H3PO4</td><td>2.1</td></tr><tr><td>H2PO4-</td><td>7.2</td></tr></table><p><b>Question:</b> the ratio at pH 7.2 is <em>unity</em>.</p>',
      },
    },
  },
];

export default function DebugViews() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: '1rem', letterSpacing: '0.08em' }}>
        RENDER_VIEW DEBUG HARNESS
      </h1>
      {CASES.map(({ label, spec }) => {
        const parsed = ViewSpecSchema.safeParse(
          typeof spec === 'object' && spec !== null && 'props' in (spec as Record<string, unknown>)
            ? { component: (spec as Record<string, unknown>).component, ...((spec as { props: object }).props) }
            : spec,
        );
        return (
          <section key={label} style={{ margin: '2.5rem 0', borderTop: '1px solid #ccc', paddingTop: '1rem' }}>
            <h2 style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: '0.8rem', color: '#666' }}>
              {label}
            </h2>
            {parsed.success ? (
              renderView(parsed.data as ViewSpec)
            ) : (
              <pre style={{ color: '#b00' }}>schema rejected: {parsed.error.message}</pre>
            )}
          </section>
        );
      })}
    </main>
  );
}
