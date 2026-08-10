import type { ReactNode } from 'react';
import type { ViewSpec } from '@/lib/views';
import AnswerGrid from './AnswerGrid';
import DataTable from './DataTable';
import FlashcardDeck from './FlashcardDeck';
import MasteryChart from './MasteryChart';
import PassageView from './PassageView';
import TimerView from './TimerView';

export function renderView(spec: ViewSpec): ReactNode {
  const key = JSON.stringify(spec);

  switch (spec.component) {
    case 'flashcard_deck':
      return <FlashcardDeck key={key} {...spec} />;
    case 'answer_grid':
      return <AnswerGrid key={key} {...spec} />;
    case 'timer':
      return <TimerView key={key} {...spec} />;
    case 'mastery_chart':
      return <MasteryChart key={key} {...spec} />;
    case 'data_table':
      return <DataTable key={key} {...spec} />;
    case 'passage':
      return <PassageView key={key} {...spec} />;
  }
}
