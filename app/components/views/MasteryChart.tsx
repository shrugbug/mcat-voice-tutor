import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'mastery_chart' }>;

export default function MasteryChart({ categories }: Props) {
  const sortedCategories = [...categories].sort((a, b) => a.mastery - b.mastery);

  return (
    <div className="view mastery-chart">
      <h2 className="view__title">Mastery</h2>
      <ul className="mastery-chart__list">
        {sortedCategories.map((category) => {
          const percentage = Math.round(category.mastery * 100);
          return (
            <li key={category.id} className="mastery-chart__item">
              <div className="mastery-chart__row">
                <span>{category.name}</span>
                <span>{percentage}%</span>
              </div>
              <div className="mastery-chart__bar">
                <div className="mastery-chart__fill" style={{ width: `${percentage}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
