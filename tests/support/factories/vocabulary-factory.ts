import { faker } from "@faker-js/faker";
import type { VocabularyEntry } from "../../../src/types/vocabulary";

export type { VocabularyEntry };

export const createVocabularyEntry = (
  overrides: Partial<VocabularyEntry> = {},
): VocabularyEntry => ({
  id: faker.string.uuid(),
  term: faker.word.noun(),
  weight: faker.number.int({ min: 0, max: 50 }),
  source: "manual",
  // SQLite 格式（UTC，無時區後綴），與真實 store 一致，供 createdAt 排序正確解析
  createdAt: faker.date.recent().toISOString().slice(0, 19).replace("T", " "),
  ...overrides,
});
