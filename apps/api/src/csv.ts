export type CsvRow = Record<string,string>;

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.length === 0) { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = []; continue;
    }
    if (ch === '"') throw new Error("Unexpected quote in an unquoted CSV field.");
    field += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some(value => value.trim() !== "")) rows.push(row);
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map(value => value.trim().replace(/^\uFEFF/, "").toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
  if (!headers.includes("name")) throw new Error('CSV must include a "name" column.');
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header,index) => [header,(values[index] ?? "").trim()])));
}

export function normalizeWebsite(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
    return ["http:","https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export function normalizeSourceUrl(value: string, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return ["http:","https:"].includes(url.protocol) ? url.toString() : fallback;
  } catch { return fallback; }
}
