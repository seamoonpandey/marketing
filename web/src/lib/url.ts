/** The address when it is an http or https URL, else null: text from a model, a page or a person never becomes a `javascript:` link. */
export function httpUrl(u: string | null | undefined): string | null {
  try {
    const url = new URL(u ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
