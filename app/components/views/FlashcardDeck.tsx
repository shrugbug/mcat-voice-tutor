'use client';

import { useState } from 'react';
import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'flashcard_deck' }>;

export default function FlashcardDeck({ cards, title }: Props) {
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[cardIndex];

  const moveTo = (nextIndex: number) => {
    setCardIndex(nextIndex);
    setFlipped(false);
  };

  return (
    <div className="view flashcard-deck">
      {title && <h2 className="view__title">{title}</h2>}
      <p className="flashcard-deck__counter">
        Card {cardIndex + 1} of {cards.length}
      </p>
      <button
        type="button"
        className={`flashcard-deck__card${flipped ? ' flashcard-deck__card--flipped' : ''}`}
        onClick={() => setFlipped((current) => !current)}
        aria-label={flipped ? 'Show the front of this flashcard' : 'Show the back of this flashcard'}
      >
        <span className="flashcard-deck__side">{flipped ? 'Back' : 'Front'}</span>
        <span className="flashcard-deck__text">{flipped ? card.back : card.front}</span>
        <span className="flashcard-deck__hint">Press to flip</span>
      </button>
      <div className="flashcard-deck__controls">
        <button
          type="button"
          className="view-button"
          onClick={() => moveTo(cardIndex - 1)}
          disabled={cardIndex === 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="view-button"
          onClick={() => moveTo(cardIndex + 1)}
          disabled={cardIndex === cards.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
