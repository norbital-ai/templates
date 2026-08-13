/** Five calendar years ending in the live year, so an in-progress year is never hidden. */
export function seasonalityYears(currentYear: number): number[] {
	return Array.from({ length: 5 }, (_value, index) => currentYear - 4 + index);
}
