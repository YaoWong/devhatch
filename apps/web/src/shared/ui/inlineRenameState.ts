export type InlineRenameSubmission =
  | { kind: "submit"; value: string }
  | { kind: "unchanged" }
  | { kind: "invalid"; error: string };

export function inlineRenameSubmission(value: string, initialValue: string, allowEmpty: boolean): InlineRenameSubmission {
  const normalizedValue = value.trim();
  if (!allowEmpty && !normalizedValue) return { kind: "invalid", error: "Name cannot be empty." };
  if (normalizedValue === initialValue.trim()) return { kind: "unchanged" };
  return { kind: "submit", value: normalizedValue };
}
