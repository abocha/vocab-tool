import { useEffect, useState } from "react";
import type { McqItem } from "../types";

interface McqProps {
  item: McqItem;
  onResult: (correct: boolean) => void;
  onNext: () => void;
  existingResult?: boolean;
}

type Feedback = "correct" | "incorrect" | null;

export function Mcq({ item, onResult, onNext, existingResult }: McqProps) {
  const [selection, setSelection] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setSelection("");
    setFeedback(null);
    setChecked(false);
  }, [item.id]);

  const handleCheck = () => {
    const isCorrect = selection === item.answer;
    setFeedback(isCorrect ? "correct" : "incorrect");
    onResult(isCorrect);
    setChecked(true);
  };

  return (
    <div className="exercise">
      <div className="exercise__prompt" aria-live="polite">
        {item.prompt}
      </div>
      {existingResult && (
        <div className="exercise__note" role="status">
          Previously answered correctly.
        </div>
      )}
      <fieldset className="exercise__options">
        <legend className="visually-hidden">Choose the best answer</legend>
        {item.options.map((option, index) => (
          <label key={`${item.id}-option-${index}`} className="exercise__option">
            <input
              type="radio"
              name={`${item.id}-options`}
              value={option}
              checked={selection === option}
              onChange={(event) => setSelection(event.target.value)}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <div className="exercise__actions">
        <button type="button" onClick={handleCheck} disabled={!selection}>
          Check
        </button>
        <button type="button" onClick={onNext} disabled={!checked}>
          Next →
        </button>
      </div>
      {feedback && (
        <div
          className={`exercise__feedback exercise__feedback--${feedback}`}
          role="status"
        >
          {feedback === "correct" ? "✓ Correct" : `✗ Not quite. Answer: ${item.answer}`}
        </div>
      )}
      {item.source && (
        <div className="exercise__meta">Source: {item.source}</div>
      )}
    </div>
  );
}
