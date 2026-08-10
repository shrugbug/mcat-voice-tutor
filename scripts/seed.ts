import { openDb } from '../lib/db';
import { seedSectionScores, seedTaxonomy } from '../lib/student';
import { loadTaxonomy } from '../lib/taxonomy';

const scoreFlags = {
  '--cp': 'chem_phys',
  '--cars': 'cars',
  '--bb': 'bio_biochem',
  '--ps': 'psych_soc',
} as const;

function parseScores(args: string[]): Record<string, number> | null {
  if (args.includes('--taxonomy-only')) {
    if (args.length !== 1) {
      throw new Error('--taxonomy-only cannot be combined with section scores.');
    }
    return null;
  }

  const scores: Record<string, number> = {};

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] as keyof typeof scoreFlags;
    const sectionId = scoreFlags[flag];
    const value = args[index + 1];

    if (!sectionId) {
      throw new Error(`Unknown score flag: ${flag}`);
    }

    if (value === undefined) {
      throw new Error(`Missing score for ${flag}.`);
    }

    const score = Number(value);
    if (!Number.isFinite(score)) {
      throw new Error(`Invalid score for ${flag}: ${value}`);
    }

    scores[sectionId] = score;
  }

  if (Object.keys(scores).length !== Object.keys(scoreFlags).length) {
    throw new Error('Provide all four section scores (--cp, --cars, --bb, --ps), or use --taxonomy-only.');
  }

  return scores;
}

function main(): void {
  const scores = parseScores(process.argv.slice(2));
  const taxonomy = loadTaxonomy();
  const categoryCount = taxonomy.sections.reduce(
    (total, section) => total + section.categories.length,
    0
  );
  const db = openDb();

  try {
    seedTaxonomy(db, taxonomy);
    if (scores) {
      seedSectionScores(db, scores);
      console.log(`Seeded ${categoryCount} categories and four section scores.`);
    } else {
      console.log(`Seeded ${categoryCount} categories (taxonomy only).`);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
