import { useEffect, useMemo, useState } from "react";
import type { BankQuality, GapFillInspectorControls, GapFillItem } from "../types";
import { isTextMatch } from "../lib/normalize";
import { deterministicShuffle } from "../lib/shuffle";

interface GapFillProps {
  item: GapFillItem;
  onResult: (correct: boolean) => void;
  onNext: () => void;
  existingResult?: boolean;
  controls?: GapFillInspectorControls;
}

type Feedback = "correct" | "incorrect" | null;

export function GapFill({ item, onResult, onNext, existingResult, controls }: GapFillProps) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAnswer("");
    setFeedback(null);
    setChecked(false);
  }, [item.id]);

  const promptSegments = useMemo(() => item.prompt.split("_____") ?? [], [item.prompt]);

  const acceptableAnswers = useMemo(() => item.answers ?? [item.answer], [item.answers, item.answer]);
  const bankQualityLabel = useMemo(() => {
    if (!item.bankQuality) return null;
    const labels: Record<BankQuality, string> = {
      solid: "Solid bank",
      soft: "Soft bank",
      needs_review: "Needs review",
    };
    return labels[item.bankQuality];
  }, [item.bankQuality]);

  const bankQualityClass = useMemo(() => {
    if (!item.bankQuality || item.bankQuality === "solid") return "";
    return `exercise__bank-badge exercise__bank-badge--${item.bankQuality}`;
  }, [item.bankQuality]);

  const bankTags = useMemo(() => item.bankMeta?.tags ?? [], [item.bankMeta?.tags]);
  const slotLabel = useMemo(() => item.bankMeta?.slot ?? null, [item.bankMeta?.slot]);

  const shuffledBank = useMemo(() => {
    if (!item.bank || item.bank.length === 0) {
      return [] as string[];
    }
    return deterministicShuffle(item.bank, `${item.id}:bank`);
  }, [item.bank, item.id]);

  const wordBank = useMemo(() => {
    if (shuffledBank.length === 0) {
      return [] as string[];
    }
    if (!controls) {
      const ensured = [...shuffledBank];
      const primaryAnswer = acceptableAnswers[0] ?? item.answer;
      const hasAnswer = ensured.some((option) => isTextMatch(option, primaryAnswer));
      if (!hasAnswer) {
        const originalAnswer = item.bank?.find((option) => isTextMatch(option, primaryAnswer)) ?? primaryAnswer;
        ensured.push(originalAnswer);
      }
      return deterministicShuffle(ensured, `${item.id}:bank:view`);
    }
    const maxItems = Math.max(1, controls.bankSize);
    let selected = shuffledBank.slice(0, Math.min(maxItems, shuffledBank.length));
    const primaryAnswer = acceptableAnswers[0] ?? item.answer;
    const hasAnswer = selected.some((option) => isTextMatch(option, primaryAnswer));
    if (!hasAnswer) {
      const sourceAnswer = shuffledBank.find((option) => isTextMatch(option, primaryAnswer)) ?? primaryAnswer;
      if (selected.length < maxItems) {
        selected = [...selected, sourceAnswer];
      } else if (selected.length > 0) {
        selected = [...selected.slice(0, selected.length - 1), sourceAnswer];
      } else {
        selected = [sourceAnswer];
      }
    }
    return deterministicShuffle(selected, `${item.id}:bank:view`);
  }, [acceptableAnswers, controls, item.answer, item.bank, item.id, shuffledBank]);

  const hintsData = item.hints ?? {};

  const textualHints = useMemo(() => {
    const hints: string[] = [];
    if (controls?.hints.initialLetter) {
      const first = hintsData.first ?? acceptableAnswers[0]?.charAt(0);
      if (first) {
        hints.push(`Starts with \u201c${first}\u201d`);
      }
    }
    if (controls?.hints.pos) {
      const posHint = hintsData.pos ?? hintsData.partOfSpeech;
      if (posHint) {
        hints.push(`Part of speech: ${posHint}`);
      }
    }
    if (controls?.hints.collocationCue) {
      const cueHint = hintsData.cue ?? hintsData.collocation ?? hintsData.partner;
      if (cueHint) {
        hints.push(`Collocation cue: ${cueHint}`);
      }
    }
    return hints;
  }, [acceptableAnswers, controls, hintsData]);

  const ttsSource = useMemo(() => {
    if (!controls?.hints.tts) {
      return "";
    }
    return hintsData.tts ?? hintsData.audio ?? "";
  }, [controls, hintsData]);

  const handleCheck = () => {
    const correct = acceptableAnswers.some((expected) => isTextMatch(answer, expected));
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
        {promptSegments.map((segment, index) => (
          <span key={`${item.id}-segment-${index}`}>
            {segment}
            {index < promptSegments.length - 1 && <span className="exercise__blank">_____</span>}
          </span>
        ))}
      </div>
      {existingResult && (
        <div className="exercise__note" role="status">
          Previously answered correctly.
        </div>
      )}
      <label className="exercise__field">
        <span className="visually-hidden">Your answer</span>
        <input
          type="text"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Fill in the blank"
        />
      </label>
      {wordBank.length > 0 && (
        <aside className="exercise__word-bank" aria-label="Word bank">
          <h4>Word bank</h4>
          {bankQualityLabel && bankQualityClass && (
            <span className={bankQualityClass}>{bankQualityLabel}</span>
          )}
          {slotLabel && <span className="exercise__slot-label">Slot: {slotLabel}</span>}
          {bankTags.length > 0 && (
            <div className="exercise__bank-tags" aria-label="Bank tags">
              {bankTags.map((tag) => (
                <span key={tag} className={`exercise__bank-tag exercise__bank-tag--${tag}`}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <ul>
            {wordBank.map((option, index) => (
              <li key={`${item.id}-bank-${index}`}>{option}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="exercise__actions">
        <button
          type="button"
          onClick={handleCheck}
          disabled={answer.trim().length === 0}
        >
          Check
        </button>
        <button
          type="button"
          onClick={onNext}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!checked}
        >
          Next →
        </button>
      </div>
      {(textualHints.length > 0 || (ttsSource && controls?.hints.tts)) && (
        <div className="exercise__hints" role="note">
          <h4>Hints</h4>
          {textualHints.length > 0 && (
            <ul>
              {textualHints.map((hint, index) => (
                <li key={`${item.id}-hint-${index}`}>{hint}</li>
              ))}
            </ul>
          )}
          {ttsSource && controls?.hints.tts && (
            <div className="exercise__hint-audio">
              <audio controls preload="none" src={ttsSource}>
                Your browser does not support the audio element.
              </audio>
            </div>
          )}
        </div>
      )}
      {feedback && (
        <div
          className={`exercise__feedback exercise__feedback--${feedback}`}
          role="status"
        >
          {feedback === "correct"
            ? "✓ Correct"
            : `✗ Not quite. Answer: ${acceptableAnswers.join(", ")}`}
        </div>
      )}
      {item.source && (
        <div className="exercise__meta">Source: {item.source}</div>
      )}
    </div>
  );
}
