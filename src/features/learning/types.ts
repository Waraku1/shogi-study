export const CONTENT_VERSION = 1;
export const subjects = [
  "Vocabulary",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Computer science",
  "History and philosophy",
] as const;
export type Subject = (typeof subjects)[number];
export type Difficulty = "High school" | "University";
export type LearningItem = Readonly<{
  id: string;
  contentVersion: number;
  subject: Subject;
  difficulty: Difficulty;
  title: string;
  prompt: string;
  answer: string;
  example?: string;
  quiz?: Readonly<{
    question: string;
    options: readonly string[];
    correctIndex: number;
  }>;
}>;
export type Review = {
  status: "remembered" | "review";
  lastReviewed: number;
  dueAt: number;
  attempts: number;
  contentVersion: number;
};
export type LearningState = {
  version: 1;
  preferences: { enabled: boolean; subject: Subject | "All" };
  reviews: Record<string, Review>;
};
export const emptyState = (): LearningState => ({
  version: 1,
  preferences: { enabled: false, subject: "All" },
  reviews: {},
});
export const guestNamespace = "guest-local";
export const accountNamespace = (id: string) => JSON.stringify(["account", id]);
