export type DupeRow = { id: string; name: string | null; address: string | null; phone_raw: string | null; review_status: string; observed_at: string };

const digits = (value: string | null) => (value || "").replace(/\D/g, "");
const clean = (value: string | null) => (value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Groups records that are very likely the same business: same phone number (7+ digits, compared on the
 * last 9 digits so +92 300… and 0300… match) or same name + address. Returns the ids to remove, keeping
 * one record per group: a record someone already reviewed wins, otherwise the oldest.
 */
export function findDuplicates(rows: DupeRow[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const seen = new Map<string, string>();
  for (const row of rows) {
    parent.set(row.id, row.id);
    const keys: string[] = [];
    const phone = digits(row.phone_raw);
    if (phone.length >= 7) keys.push("p:" + phone.slice(-9));
    const name = clean(row.name), address = clean(row.address);
    if (name && address) keys.push("n:" + name + "|" + address);
    for (const key of keys) { const other = seen.get(key); if (other) union(row.id, other); else seen.set(key, row.id); }
  }
  const groups = new Map<string, DupeRow[]>();
  for (const row of rows) { const root = find(row.id); groups.set(root, [...(groups.get(root) || []), row]); }
  const remove: string[] = [];
  let groupCount = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupCount++;
    const keeper = [...group].sort((a, b) => (a.review_status === "pending" ? 1 : 0) - (b.review_status === "pending" ? 1 : 0) || a.observed_at.localeCompare(b.observed_at))[0];
    for (const row of group) if (row.id !== keeper.id) remove.push(row.id);
  }
  return { groups: groupCount, remove };
}
