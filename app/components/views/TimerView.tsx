'use client';

import { useEffect, useState } from 'react';
import type { ViewSpec } from '@/lib/views';

type Props = Extract<ViewSpec, { component: 'timer' }>;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

export default function TimerView({ seconds, label, running }: Props) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!running) return;

    const intervalId = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [running]);

  return (
    <div className="view timer-view">
      {label && <h2 className="timer-view__label">{label}</h2>}
      <p className="timer-view__time" role="timer" aria-live="off">
        {formatTime(remaining)}
      </p>
    </div>
  );
}
