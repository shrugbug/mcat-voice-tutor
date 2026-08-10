'use client';

import type { CategoryProfile, Profile } from '@/lib/student';

export type Tally = { asked: number; correct: number };

type Props = {
  profile: Profile | null;
  tally: Tally;
};

function weakestCategories(profile: Profile): CategoryProfile[] {
  const byId = new Map(profile.categories.map((c) => [c.id, c]));
  return profile.weakest
    .map((id) => byId.get(id))
    .filter((c): c is CategoryProfile => c !== undefined)
    .slice(0, 5);
}

/** Right 1/3 of the layout: weakest categories + running session tally. */
export default function MasterySidebar({ profile, tally }: Props) {
  return (
    <aside className="mastery-sidebar">
      <h2 className="mastery-sidebar__title">Weakest categories</h2>
      {!profile && <p className="mastery-sidebar__empty">Loading profile...</p>}
      {profile && profile.categories.length === 0 && (
        <p className="mastery-sidebar__empty">No categories seeded yet.</p>
      )}
      {profile && profile.categories.length > 0 && (
        <ul className="mastery-list">
          {weakestCategories(profile).map((c) => (
            <li key={c.id} className="mastery-list__item">
              <div className="mastery-list__row">
                <span className="mastery-list__name">{c.name}</span>
                <span className="mastery-list__pct">{Math.round(c.mastery * 100)}%</span>
              </div>
              <div className="mastery-bar">
                <div className="mastery-bar__fill" style={{ width: `${Math.round(c.mastery * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="session-tally">
        <h2 className="mastery-sidebar__title">This session</h2>
        <p className="session-tally__line">
          Asked: <strong>{tally.asked}</strong> &nbsp;|&nbsp; Correct:{' '}
          <strong>{tally.correct}</strong>
        </p>
      </div>
    </aside>
  );
}
