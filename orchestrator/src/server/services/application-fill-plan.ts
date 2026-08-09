import type {
  ApplicationAnswerConfig,
  ApplicationFillPlan,
  ApplicationQuestion,
} from "@shared/types/application";
import {
  loadApplicationAnswerConfig,
  resolveApplicationAnswer,
} from "./application-answer-config";

/**
 * Converts a captured application form into a conservative fill plan. The
 * caller is responsible for applying these values in a browser. Submission is
 * permitted only when every captured question resolved and the extension has
 * obtained an explicit user confirmation.
 */
export function createApplicationFillPlan(
  jobId: string,
  questions: ApplicationQuestion[],
  config: ApplicationAnswerConfig = loadApplicationAnswerConfig(),
): ApplicationFillPlan {
  const answers: ApplicationFillPlan["answers"] = [];
  const unresolved: ApplicationFillPlan["unresolved"] = [];

  for (const [index, question] of questions.entries()) {
    const result = resolveApplicationAnswer(question, config);
    if ("value" in result) {
      answers.push({ index, answer: result });
      continue;
    }

    unresolved.push({
      index,
      question: { label: question.label, name: question.name },
      unresolved: result,
    });
  }

  return {
    jobId,
    answers,
    unresolved,
    requiresReview: true,
    submission: {
      allowed: unresolved.length === 0,
      requiresConfirmation: true,
      reason: unresolved.length > 0 ? "unresolved_questions" : null,
    },
  };
}
