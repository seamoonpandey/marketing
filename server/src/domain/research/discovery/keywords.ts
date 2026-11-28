/** The owner's keywords cleaned: ValidationError when none are left, more than 15, or one over 80 characters. */
export function cleanKeywords(raw: string[]): string[] {
  throw new Error('not built: cleanKeywords');
}

/** 6 to 10 search keywords from the brand's approved facts; ValidationError with no approved facts. */
export async function suggestKeywords(brandId: string): Promise<string[]> {
  throw new Error('not built: suggestKeywords');
}
