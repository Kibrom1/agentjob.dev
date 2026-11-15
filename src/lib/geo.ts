/**
 * Best-effort country resolution for scraped location strings, used only for
 * structured data. Returns null when the country cannot be determined with
 * confidence, so callers omit the field instead of guessing.
 */

export type Country = { code: string; name: string };

const US: Country = { code: "US", name: "United States" };
const CA: Country = { code: "CA", name: "Canada" };

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);
const CA_PROVINCES = new Set("AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" "));

const COUNTRIES: Record<string, Country> = {
  us: US,
  usa: US,
  "u.s.": US,
  "u.s.a.": US,
  "united states": US,
  "united states of america": US,
  canada: CA,
  uk: { code: "GB", name: "United Kingdom" },
  "u.k.": { code: "GB", name: "United Kingdom" },
  "united kingdom": { code: "GB", name: "United Kingdom" },
  england: { code: "GB", name: "United Kingdom" },
  ireland: { code: "IE", name: "Ireland" },
  germany: { code: "DE", name: "Germany" },
  france: { code: "FR", name: "France" },
  netherlands: { code: "NL", name: "Netherlands" },
  spain: { code: "ES", name: "Spain" },
  italy: { code: "IT", name: "Italy" },
  portugal: { code: "PT", name: "Portugal" },
  poland: { code: "PL", name: "Poland" },
  sweden: { code: "SE", name: "Sweden" },
  switzerland: { code: "CH", name: "Switzerland" },
  denmark: { code: "DK", name: "Denmark" },
  norway: { code: "NO", name: "Norway" },
  finland: { code: "FI", name: "Finland" },
  austria: { code: "AT", name: "Austria" },
  belgium: { code: "BE", name: "Belgium" },
  israel: { code: "IL", name: "Israel" },
  india: { code: "IN", name: "India" },
  singapore: { code: "SG", name: "Singapore" },
  japan: { code: "JP", name: "Japan" },
  "south korea": { code: "KR", name: "South Korea" },
  korea: { code: "KR", name: "South Korea" },
  australia: { code: "AU", name: "Australia" },
  "new zealand": { code: "NZ", name: "New Zealand" },
  brazil: { code: "BR", name: "Brazil" },
  mexico: { code: "MX", name: "Mexico" },
  argentina: { code: "AR", name: "Argentina" },
  kuwait: { code: "KW", name: "Kuwait" },
  "united arab emirates": { code: "AE", name: "United Arab Emirates" },
  uae: { code: "AE", name: "United Arab Emirates" },
  "saudi arabia": { code: "SA", name: "Saudi Arabia" },
  "south africa": { code: "ZA", name: "South Africa" },
  nigeria: { code: "NG", name: "Nigeria" },
  kenya: { code: "KE", name: "Kenya" },
  egypt: { code: "EG", name: "Egypt" },
  turkey: { code: "TR", name: "Turkey" },
  romania: { code: "RO", name: "Romania" },
  ukraine: { code: "UA", name: "Ukraine" },
  "czech republic": { code: "CZ", name: "Czechia" },
  czechia: { code: "CZ", name: "Czechia" },
  china: { code: "CN", name: "China" },
  "hong kong": { code: "HK", name: "Hong Kong" },
  taiwan: { code: "TW", name: "Taiwan" },
};

/** Cities that are unambiguous enough to resolve without a country suffix. */
const CITIES: Record<string, Country> = {
  "san francisco": US,
  "new york": US,
  "new york city": US,
  seattle: US,
  austin: US,
  boston: US,
  chicago: US,
  "los angeles": US,
  "palo alto": US,
  "mountain view": US,
  london: COUNTRIES["united kingdom"]!,
  dublin: COUNTRIES.ireland!,
  paris: COUNTRIES.france!,
  berlin: COUNTRIES.germany!,
  munich: COUNTRIES.germany!,
  amsterdam: COUNTRIES.netherlands!,
  toronto: CA,
  vancouver: CA,
  zurich: COUNTRIES.switzerland!,
  tokyo: COUNTRIES.japan!,
  sydney: COUNTRIES.australia!,
  bengaluru: COUNTRIES.india!,
  bangalore: COUNTRIES.india!,
  "tel aviv": COUNTRIES.israel!,
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Tokens a location string may carry its country in: comma parts, parentheses, dash parts. */
function tokens(text: string): string[] {
  return text
    .split(/[,()/–—-]|\s+-\s+/)
    .map(clean)
    .filter(Boolean);
}

export function resolveCountry(text: string): Country | null {
  const parts = tokens(text);
  // Prefer the right-most token: "Kuwait City, Kuwait", "Austin, TX".
  for (const part of [...parts].reverse()) {
    const upper = part.toUpperCase();
    if (part === upper && part.length === 2) {
      if (US_STATES.has(upper) && !CA_PROVINCES.has(upper)) return US;
      if (CA_PROVINCES.has(upper)) return CA;
      if (US_STATES.has(upper)) return US;
    }
    const country = COUNTRIES[part.toLowerCase()];
    if (country) return country;
  }
  for (const part of parts) {
    const city = CITIES[part.toLowerCase()];
    if (city) return city;
  }
  return null;
}

export type PlaceParts = { locality: string; region?: string; country: Country };

/** "San Francisco, CA" -> { locality, region: "CA", country: US }; null when no country resolves. */
export function resolvePlace(text: string): PlaceParts | null {
  const country = resolveCountry(text);
  if (!country) return null;
  const parts = text.split(",").map(clean).filter(Boolean);
  const locality = parts[0] ?? text;
  const last = parts[parts.length - 1] ?? "";
  const region = parts.length > 1 && /^[A-Z]{2}$/.test(last) ? last : undefined;
  return { locality, ...(region ? { region } : {}), country };
}

/** True for labels that describe a work arrangement rather than a place. */
export function isRemoteLabel(text: string): boolean {
  return /^(fully\s+)?remote\b/i.test(clean(text)) || /^anywhere\b/i.test(clean(text));
}
