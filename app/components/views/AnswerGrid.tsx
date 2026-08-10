import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'answer_grid' }>;

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export default function AnswerGrid({ options, revealed, correctIndex }: Props) {
  return (
    <div className="view answer-grid">
      <ol className="answer-grid__options">
        {options.map((option, index) => {
          const resultClass = revealed
            ? index === correctIndex
              ? ' answer-grid__option--correct'
              : ' answer-grid__option--muted'
            : '';

          return (
            <li key={OPTION_LETTERS[index]} className={`answer-grid__option${resultClass}`}>
              <span className="answer-grid__letter">{OPTION_LETTERS[index]}</span>
              <span>{option}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
