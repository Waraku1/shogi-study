import { test, expect } from "vitest";
import { learningItems } from "../src/features/learning/content";
test("editorial checks retain 124 original cards; subject correction and sample answer key", () => {
  expect(learningItems).toHaveLength(124);
  const expected: Record<string, string> = {
    "concept-derivative": "2x",
    "concept-probability": "1/4",
    "concept-median": "4",
    "concept-logarithm": "4",
    "concept-force": "6 N",
    "concept-energy": "4",
    "concept-waves": "6 m/s",
    "concept-ph": "10",
    "concept-catalyst": "Reaction rate",
    "concept-isotope": "Neutrons",
  };
  for (const item of learningItems) {
    expect(item.title.trim()).toBe(item.title);
    expect(item.prompt.trim()).toBe(item.prompt);
    expect(item.answer.trim()).toBe(item.answer);
    if (item.quiz) {
      expect(
        item.quiz.options.every((o) => o.trim() === o && o.length > 0),
      ).toBe(true);
      if (expected[item.id])
        expect(item.quiz.options[item.quiz.correctIndex]).toBe(
          expected[item.id],
        );
    }
  }
  expect(
    learningItems.find((i) => i.id === "concept-opportunity-cost")?.subject,
  ).toBe("Economics");
});
