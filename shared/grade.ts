/**
 * Raridade do item (dwItemGrade, defineItemGrade.h) e a cor do nome como no cliente FlyFF:
 * comum (branco), unique (verde), ultimate (roxo), baruna (laranja).
 */
export const GRADES: Record<number, { name: string; cls: string }> = {
  100: { name: 'Comum', cls: 'grade-normal' },
  200: { name: 'Unique', cls: 'grade-unique' },
  300: { name: 'Ultimate', cls: 'grade-ultimate' },
  400: { name: 'Baruna', cls: 'grade-baruna' },
};
export const gradeOf = (gr: number | undefined) => GRADES[gr ?? 100] ?? GRADES[100];
