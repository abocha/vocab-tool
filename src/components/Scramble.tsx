import { useEffect, useState } from "react";
import type { ScrambleItem } from "../types";
import { isTextMatch } from "../lib/normalize";

interface ScrambleProps {
  item: ScrambleItem;
  onResult: (correct: boolean) => void;
  onNext: () => void;
  existingResult?: boolean;
}

type Feedback = "correct" | "incorrect" | null;

export function Scramble({ item, onResult, onNext, existingResult }: ScrambleProps) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAnswer("");
    setFeedback(null);
    setChecked(false);
  }, [item.id]);

  const handleCheck = () => {
    const correct = isTextMatch(answer, item.answer);
    setFeedback(correct ? "correct" : "incorrect");
    setChecked(true);
    onResult(correct);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && answer.trim().length > 0) {
      event.preventDefault();
      handleCheck();
    }
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
      <label className="exercise__field">
        <span className="visually-hidden">Reconstruct the sentence</span>
        <input
          type="text"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Type the sentence"
        />
      </label>
      <div className="exercise__actions">
        <button type="button" onClick={handleCheck} disabled={answer.trim().length === 0}>
          Check
        </button>
        <button type="button" onClick={onNext}>
          Skip
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
      {item.source && <div className="exercise__meta">Source: {item.source}</div>}
    </div>
  );
}
