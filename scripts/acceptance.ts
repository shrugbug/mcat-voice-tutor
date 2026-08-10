/**
 * End-to-end acceptance script: drives /api/tool through a realistic study-session
 * sequence against a running dev server and asserts the contract the voice bot relies on.
 *
 * Usage: npm run acceptance   (requires `npm run dev` already running on :3000)
 */
import { QuestionSchema, type Question } from '../lib/questions';

const BASE_URL = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3000';

type Profile = {
  categories: { id: string; section: string; name: string; mastery: number; attempts: number }[];
  lastSession: { mode: string; summary: string; focusNext: string } | null;
  weakest: string[];
};

class AssertionError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

async function callTool(name: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/api/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });

  if (!response.ok) {
    throw new AssertionError(`${name}: HTTP ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) {
    throw new AssertionError(`${name}: tool returned error: ${body.error}`);
  }
  return body.result;
}

function findCategory(profile: Profile, categoryId: string) {
  const category = profile.categories.find((c) => c.id === categoryId);
  assert(category, `profile is missing category ${categoryId}`);
  return category!;
}

async function main(): Promise<void> {
  const MODE = 'drill';

  console.log(`\n[1/8] get_student_profile`);
  const profile1 = (await callTool('get_student_profile', {})) as Profile;
  assert(profile1.categories.length > 0, 'profile has no categories — run `npm run seed` first');
  assert(profile1.weakest.length > 0, 'profile.weakest is empty');

  const categoryId = profile1.weakest[0];
  const before = findCategory(profile1, categoryId);
  console.log(`  weakest category: ${categoryId} (${before.name}), mastery=${before.mastery.toFixed(3)}`);

  console.log(`\n[2/8] generate_question (${categoryId}, difficulty=1)`);
  const q1raw = await callTool('generate_question', {
    categoryId,
    difficulty: 1,
    style: 'discrete',
  });
  const q1 = QuestionSchema.parse(q1raw) as Question;
  assert(q1.categoryId === categoryId, `question categoryId mismatch: expected ${categoryId}, got ${q1.categoryId}`);
  console.log('  generated question:');
  console.log(JSON.stringify(q1, null, 2));

  console.log(`\n[3/8] record_result (wrong, errorType=content, difficulty=1)`);
  const record1 = (await callTool('record_result', {
    categoryId,
    difficulty: 1,
    correct: false,
    errorType: 'content',
    mode: MODE,
  })) as { ok: boolean; newMastery: number };
  assert(record1.ok, 'record_result (wrong) did not return ok: true');
  assert(
    record1.newMastery < before.mastery,
    `mastery should drop after a wrong answer: before=${before.mastery}, after=${record1.newMastery}`
  );
  console.log(`  mastery: ${before.mastery.toFixed(3)} -> ${record1.newMastery.toFixed(3)} (dropped, as expected)`);

  console.log(`\n[4/8] generate_question (${categoryId}, difficulty=2 — escalated after wrong answer)`);
  const q2raw = await callTool('generate_question', {
    categoryId,
    difficulty: 2,
    style: 'discrete',
  });
  const q2 = QuestionSchema.parse(q2raw) as Question;
  assert(q2.categoryId === categoryId, `question categoryId mismatch: expected ${categoryId}, got ${q2.categoryId}`);
  assert(q2.difficulty === 2, `expected difficulty 2, got ${q2.difficulty}`);

  console.log(`\n[5/8] record_result (correct, difficulty=2)`);
  const record2 = (await callTool('record_result', {
    categoryId,
    difficulty: 2,
    correct: true,
    mode: MODE,
  })) as { ok: boolean; newMastery: number };
  assert(record2.ok, 'record_result (correct) did not return ok: true');
  assert(
    record2.newMastery > record1.newMastery,
    `mastery should rise after a correct answer: before=${record1.newMastery}, after=${record2.newMastery}`
  );
  console.log(`  mastery: ${record1.newMastery.toFixed(3)} -> ${record2.newMastery.toFixed(3)} (rose, as expected)`);

  console.log(`\n[6/8] search_materials`);
  const searchResults = (await callTool('search_materials', {
    query: before.name,
    k: 3,
  })) as unknown[];
  assert(Array.isArray(searchResults), 'search_materials did not return an array');
  console.log(`  returned ${searchResults.length} chunk(s)`);

  console.log(`\n[7/8] end_session_summary`);
  const summaryText = `Acceptance run drilled ${categoryId} (${before.name}): one miss (content), one recovery at higher difficulty.`;
  const focusNextText = `Keep drilling ${categoryId} at difficulty 2-3 next session.`;
  const summaryResult = (await callTool('end_session_summary', {
    mode: MODE,
    summary: summaryText,
    focusNext: focusNextText,
  })) as { ok: boolean };
  assert(summaryResult.ok, 'end_session_summary did not return ok: true');

  console.log(`\n[8/8] get_student_profile (again — verify round-trip)`);
  const profile2 = (await callTool('get_student_profile', {})) as Profile;
  assert(profile2.lastSession !== null, 'profile.lastSession is null after end_session_summary');
  assert(
    profile2.lastSession!.mode === MODE,
    `lastSession.mode mismatch: expected ${MODE}, got ${profile2.lastSession!.mode}`
  );
  assert(
    profile2.lastSession!.summary === summaryText,
    `lastSession.summary did not round-trip:\n  expected: ${summaryText}\n  actual:   ${profile2.lastSession!.summary}`
  );
  assert(
    profile2.lastSession!.focusNext === focusNextText,
    `lastSession.focusNext did not round-trip:\n  expected: ${focusNextText}\n  actual:   ${profile2.lastSession!.focusNext}`
  );

  const after = findCategory(profile2, categoryId);
  assert(
    after.attempts === before.attempts + 2,
    `expected ${categoryId} attempts to increase by 2, went ${before.attempts} -> ${after.attempts}`
  );

  console.log('\nACCEPTANCE PASSED\n');
}

main().catch((error) => {
  const label = error instanceof AssertionError ? 'ACCEPTANCE FAILED' : 'ACCEPTANCE ERRORED';
  console.error(`\n${label}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
