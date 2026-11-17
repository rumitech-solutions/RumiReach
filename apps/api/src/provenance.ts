export type FieldObservationValue = { field_name: string; field_value: string };

export function findFieldConflicts(observations: FieldObservationValue[]): Array<{field:string;values:string[]}> {
  const grouped = new Map<string, Set<string>>();
  for (const item of observations) {
    const field = item.field_name.trim();
    const value = item.field_value.trim();
    if (!field || !value) continue;
    if (!grouped.has(field)) grouped.set(field, new Set<string>());
    grouped.get(field)!.add(value);
  }
  return [...grouped.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([field, values]) => ({ field, values: [...values].sort((a,b) => a.localeCompare(b)) }));
}
