import { faker } from "@faker-js/faker";
import type { ReplacementRule } from "../../../src/types/replacement";

export type { ReplacementRule };

export const createReplacementRule = (
  overrides: Partial<ReplacementRule> = {},
): ReplacementRule => ({
  id: faker.string.uuid(),
  patterns: [faker.word.noun()],
  replacement: faker.word.noun(),
  isRegex: false,
  timing: "beforeAI",
  enabled: true,
  ...overrides,
});
