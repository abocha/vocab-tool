import { useEffect, useMemo, useState } from "react";
import { createHash } from "../lib/id";
import type { MatchingItem } from "../types";

interface MatchingProps {
  item: MatchingItem;
  onResult: (correct: boolean) => void;
  onNext: () => void;
  existingResult?: boolean;
}

type PairResult = "correct" | "incorrect" | null;

function hashToNumber(seed: string): number {
  const hex = createHash(seed);
  return Number.parseInt(hex.slice(0, 8), 16);
}

function getDeterministicOrder(length: number, seed: string): number[] {
  return Array.from({ length }, (_, index) => index).sort((a, b) => {
    const hashA = hashToNumber(`${seed}:${a}`);
    const hashB = hashToNumber(`${seed}:${b}`);
    return hashA - hashB;
  });
}

function deterministicShuffle<T>(values: T[], seed: string): T[] {
  const order = getDeterministicOrder(values.length, seed);
  return order.map((index) => values[index]);
}

export function Matching({ item, onResult, onNext, existingResult }: MatchingProps) {
  const limitedPairs = item.pairs;
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [pairFeedback, setPairFeedback] = useState<Record<number, PairResult>>({});
  const [checked, setChecked] = useState(false);
  const [resultSummary, setResultSummary] = useState({ correct: 0, total: limitedPairs.length });

  const rightOptions = useMemo(
    () => deterministicShuffle(limitedPairs.map((pair) => pair.right), `${item.id}:options`),
    [item.id, limitedPairs],
  );

  useEffect(() => {
    setSelections({});
    setPairFeedback({});
    setChecked(false);
    setResultSummary({ correct: 0, total: limitedPairs.length });
  }, [item.id, limitedPairs]);

  const handleSelection = (index: number, value: string) => {
    setSelections((prev) => ({
      ...prev,
      [index]: value,
    }));
  };

  const handleCheck = () => {
    const nextFeedback: Record<number, PairResult> = {};
    let correctCount = 0;
    limitedPairs.forEach((pair, index) => {
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
    setResultSummary({ correct: correctCount, total: limitedPairs.length });
    onResult(correctCount === limitedPairs.length && limitedPairs.length > 0);
  };

  const percentage = resultSummary.total
    ? Math.round((resultSummary.correct / resultSummary.total) * 100)
    : 0;

  return (
    <div className="exercise">
      <div className="exercise__matching">
        <div className="exercise__matching-column" aria-label="Left column">
          {limitedPairs.map((pair, index) => (
            <div key={`${item.id}-left-${index}`} className="exercise__matching-row">
              <span className="exercise__matching-term">{pair.left}</span>
            </div>
          ))}
        </div>
        <div className="exercise__matching-column" aria-label="Right column">
          {limitedPairs.map((pair, index) => {
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
