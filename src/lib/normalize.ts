export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isTextMatch(userInput: string, expected: string): boolean {
  return normalizeText(userInput) === normalizeText(expected);
}
