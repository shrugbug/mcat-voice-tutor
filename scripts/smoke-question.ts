import { generateQuestion, QuestionSchema } from '../lib/questions';

async function main(): Promise<void> {
  const question = await generateQuestion({
    categoryId: '5A',
    categoryName: 'Unique nature of water and its solutions',
    topics: ['Acid-Base Equilibria', 'Ions in Solutions', 'Solubility', 'Titration'],
    difficulty: 3,
    style: 'passage',
  });

  const validated = QuestionSchema.parse(question);
  console.log(JSON.stringify(validated, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
