export type RenameSubmission =
  | { kind: "submit"; value: string }
  | { kind: "unchanged" }
  | { kind: "invalid"; error: string };

export function renameSubmission(value: string, initialValue: string, allowEmpty: boolean, maxLength = 120): RenameSubmission {
  const normalizedValue = value.trim();
  if (!allowEmpty && !normalizedValue) return { kind: "invalid", error: "Name cannot be empty." };
  if (normalizedValue.length > maxLength) return { kind: "invalid", error: `Name must not exceed ${maxLength} characters.` };
  if (normalizedValue === initialValue.trim()) return { kind: "unchanged" };
  return { kind: "submit", value: normalizedValue };
}
