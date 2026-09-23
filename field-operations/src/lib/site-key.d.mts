/** The address as a site key compares it: uppercase, one spelling per street word, no punctuation. */
export function normalizeAddress(address: string): string;
/** The key of a site typed as `address` and, when picked on a map, geocoded as `formattedAddress`. */
export function siteKey(address: string, formattedAddress?: string | null): string;
/** `siteKey` over a `sites` row's `name` and `location`, as SQL for the generated column. */
export function siteKeySql(): string;
