import { useEffect, useRef, useState } from "react";
import { learningItems } from "./content";
import { LearningStore, recordReview, reviewQueue } from "./store";
import { emptyState, subjects } from "./types";
import type { LearningState, Review } from "./types";
import "./learning.css";
export function QuickLearn({
  namespace,
  available = true,
  standalone = false,
  contextKey = "standalone",
}: {
  namespace: string;
  available?: boolean;
  standalone?: boolean;
  contextKey?: string;
}) {
  const service = useRef<LearningStore | null>(null);
  const [state, setState] = useState<LearningState>(emptyState),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [warning, setWarning] = useState(""),
    [current, setCurrent] = useState(""),
    [revealed, setRevealed] = useState(false),
    [choice, setChoice] = useState<number | null>(null),
    [graded, setGraded] = useState(false),
    [dismissed, setDismissed] = useState(false),
    [reset, setReset] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const store = new LearningStore(namespace);
    service.current = store;
    let active = true;
    setReady(false);
    store.read().then((s) => {
      if (!active) return;
      setState(s);
      setWarning(store.warning);
      setCurrent(reviewQueue(learningItems, s, Date.now())[0]?.id ?? "");
      setReady(true);
    });
    return () => {
      active = false;
      store.close();
    };
  }, [namespace]);
  useEffect(() => {
    setDismissed(false);
    setRevealed(false);
    setChoice(null);
    setGraded(false);
    setReset(false);
    setMessage("");
  }, [available, contextKey]);
  const queue = reviewQueue(learningItems, state, Date.now());
  const card = queue.find((i) => i.id === current) ?? queue[0];
  const shown =
    ready &&
    available &&
    (standalone || state.preferences.enabled) &&
    !dismissed;
  async function save(next: LearningState) {
    const store = service.current;
    if (!store) return;
    setBusy(true);
    setState(next);
    try {
      await store.write(next);
      setWarning(store.warning);
    } catch {
      setWarning("The review could not be saved. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  function clearCard() {
    setRevealed(false);
    setChoice(null);
    setGraded(false);
    setMessage("");
  }
  async function grade(status: Review["status"]) {
    if (!card || graded || busy) return;
    await save(recordReview(state, card.id, status, Date.now()));
    setGraded(true);
    setMessage(
      status === "remembered"
        ? "Remembered — due in 1 day."
        : "Review again — due in 5 minutes.",
    );
  }
  return (
    <aside
      className="quick-learn"
      aria-label={standalone ? "Learning cards" : "Quick Learn"}
    >
      <h2>{standalone ? "Learning cards" : "Quick Learn"}</h2>
      {!standalone && (
        <label>
          <input
            type="checkbox"
            checked={ready && state.preferences.enabled}
            disabled={!ready || busy}
            onChange={(e) => {
              setDismissed(false);
              void save({
                ...state,
                preferences: {
                  ...state.preferences,
                  enabled: e.target.checked,
                },
              });
            }}
          />{" "}
          Enable Quick Learn
        </label>
      )}
      <p className="learning-caption">
        {standalone
          ? "Guest-local progress on this device."
          : "Optional study for this account on this device."}{" "}
        No game advice.
      </p>
      {busy && <p role="status">Saving learning changes…</p>}
      {warning && (
        <p role="status" className="learning-warning">
          {warning}
        </p>
      )}
      {!ready && <p role="status">Loading learning progress…</p>}
      {ready && !shown && (
        <p>
          {!available
            ? "Cards are paused while you play or reconnect."
            : dismissed
              ? "Learning is collapsed."
              : "Turn on Quick Learn to study while waiting."}
        </p>
      )}
      {ready &&
        available &&
        dismissed &&
        (standalone || state.preferences.enabled) && (
          <button onClick={() => setDismissed(false)}>Open cards</button>
        )}
      {shown && card && (
        <section aria-label="Study card">
          <div className="learning-actions">
            <label>
              Subject
              <select
                aria-label="Learning subject"
                disabled={busy}
                value={state.preferences.subject}
                onChange={(e) => {
                  clearCard();
                  setCurrent("");
                  void save({
                    ...state,
                    preferences: {
                      ...state.preferences,
                      subject: e.target
                        .value as LearningState["preferences"]["subject"],
                    },
                  });
                }}
              >
                <option>All</option>
                {subjects.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setDismissed(true);
                setReset(false);
              }}
            >
              Dismiss cards
            </button>
          </div>
          <p className="learning-caption">
            {card.subject} · {card.difficulty} · Content v{card.contentVersion}
          </p>
          <h3 data-testid="learning-title">{card.title}</h3>
          <p>{card.prompt}</p>
          {!revealed && (
            <button onClick={() => setRevealed(true)}>Reveal answer</button>
          )}
          {card.quiz && !revealed && (
            <fieldset>
              <legend>{card.quiz.question}</legend>
              {card.quiz.options.map((option, index) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={`quiz-${card.id}`}
                    checked={choice === index}
                    onChange={() => setChoice(index)}
                  />
                  {option}
                </label>
              ))}
              <button
                disabled={choice === null}
                onClick={() => setRevealed(true)}
              >
                Check answer
              </button>
            </fieldset>
          )}
          {revealed && (
            <div className="learning-answer">
              {choice !== null && card.quiz && (
                <p role="status">
                  {choice === card.quiz.correctIndex
                    ? "Correct."
                    : "Not quite. Review the explanation below."}
                </p>
              )}
              <p>{card.answer}</p>
              {card.example && (
                <p>
                  <em>Example:</em> {card.example}
                </p>
              )}
            </div>
          )}
          <div className="learning-actions">
            <button
              disabled={!revealed || graded || busy}
              onClick={() => void grade("remembered")}
            >
              Remembered
            </button>
            <button
              disabled={!revealed || graded || busy}
              onClick={() => void grade("review")}
            >
              Review again
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const next = queue.find((i) => i.id !== card.id) ?? card;
                setCurrent(next.id);
                clearCard();
              }}
            >
              Next card
            </button>
          </div>
          <p role="status">{message}</p>
        </section>
      )}
      {ready && (
        <>
          <p data-testid="learning-progress">
            {Object.keys(state.reviews).length} cards reviewed ·{" "}
            {
              Object.values(state.reviews).filter((r) => r.dueAt <= Date.now())
                .length
            }{" "}
            due
          </p>
          <button disabled={busy} onClick={() => setReset(true)}>
            Reset local progress
          </button>
        </>
      )}
      {reset && (
        <div role="alertdialog" aria-label="Reset learning progress">
          <p>
            Reset learning progress for this profile on this device? Preferences
            and other profiles are kept.
          </p>
          <button onClick={() => setReset(false)}>Cancel reset</button>
          <button
            disabled={busy}
            onClick={async () => {
              await save({ ...state, reviews: {} });
              clearCard();
              setReset(false);
            }}
          >
            Confirm reset
          </button>
        </div>
      )}
    </aside>
  );
}
