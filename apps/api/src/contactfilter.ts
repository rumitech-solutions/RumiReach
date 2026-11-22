/** Contact filters: comma-separated and combinable, e.g. "phone,nowebsite" = has a phone number AND no website. */
const CONTACT_COLUMNS: Record<string, string> = { phone: "phone_raw", website: "website_url", email: "public_email" };
export function contactFilterClauses(value?: string): string[] {
  const clauses: string[] = [];
  for (const token of (value || "").split(",").map(item => item.trim().toLowerCase())) {
    const missing = token.startsWith("no"); const column = CONTACT_COLUMNS[missing ? token.slice(2) : token];
    if (column) clauses.push("COALESCE(" + column + ", '') " + (missing ? "= ''" : "!= ''"));
  }
  return clauses;
}

