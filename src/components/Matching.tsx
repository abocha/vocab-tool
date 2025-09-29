import { useEffect, useMemo, useState } from "react";
import type { MatchingItem } from "../types";

interface MatchingProps {
  item: MatchingItem;
  onResult: (correct: boolean) => void;
  onNext: () => void;
  existingResult?: boolean;
}

type PairResult = "correct" | "incorrect" | null;

function shuffle<T>(values: T[]): T[] {
  const array = [...values];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function Matching({ item, onResult, onNext, existingResult }: MatchingProps) {
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [pairFeedback, setPairFeedback] = useState<Record<number, PairResult>>({});
  const [checked, setChecked] = useState(false);
  const [resultSummary, setResultSummary] = useState({ correct: 0, total: item.pairs.length });

  const rightOptions = useMemo(
    () => shuffle(item.pairs.map((pair) => pair.right)),
    [item.id],
  );

  useEffect(() => {
    setSelections({});
    setPairFeedback({});
    setChecked(false);
    setResultSummary({ correct: 0, total: item.pairs.length });
  }, [item.id, item.pairs.length]);

  const handleSelection = (index: number, value: string) => {
    setSelections((prev) => ({
      ...prev,
      [index]: value,
    }));
  };

  const handleCheck = () => {
    const nextFeedback: Record<number, PairResult> = {};
    let correctCount = 0;
    item.pairs.forEach((pair, index) => {
      const chosen = selections[index];
      if (chosen && chosen === pair.right) {
        nextFeedback[index] = "correct";
        correctCount += 1;
      } else {
        nextFeedback[index] = "incorrect";
      }
    });

    setPairFeedback(nextFeedback);
    setChecked(true);
    setResultSummary({ correct: correctCount, total: item.pairs.length });
    onResult(correctCount === item.pairs.length && item.pairs.length > 0);
  };

  const percentage = resultSummary.total
    ? Math.round((resultSummary.correct / resultSummary.total) * 100)
    : 0;

  return (
    <div className="exercise">
      <div className="exercise__matching">
        <div className="exercise__matching-column" aria-label="Left column">
          {item.pairs.map((pair, index) => (
            <div key={`${item.id}-left-${index}`} className="exercise__matching-row">
              <span className="exercise__matching-term">{pair.left}</span>
            </div>
          ))}
        </div>
        <div className="exercise__matching-column" aria-label="Right column">
          {item.pairs.map((pair, index) => {
            const feedback = pairFeedback[index];
            return (
              <label key={`${item.id}-select-${index}`} className="exercise__matching-row">
                <span className="visually-hidden">Match for {pair.left}</span>
                <select
                  value={selections[index] ?? ""}
                  onChange={(event) => handleSelection(index, event.target.value)}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {rightOptions.map((option, optionIndex) => (
                    <option key={`${item.id}-option-${optionIndex}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {feedback && (
                  <span
                    className={`exercise__feedback exercise__feedback--inline exercise__feedback--${feedback}`}
                    role="status"
                  >
                    {feedback === "correct" ? "✓" : "✗"}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
      {existingResult && (
        <div className="exercise__note" role="status">
          Previously answered correctly.
        </div>
      )}
      <div className="exercise__actions">
        <button type="button" onClick={handleCheck}>
          Check all
        </button>
        <button type="button" onClick={onNext} disabled={!checked}>
          Next →
        </button>
      </div>
      {item.source && <div className="exercise__meta">Source: {item.source}</div>}
      {checked && (
        <div className="matching__scores" aria-live="polite">
          <span>Set score: {resultSummary.correct}/{resultSummary.total}</span>
          <span>Overall score: {percentage}%</span>
        </div>
      )}
    </div>
  );
}
