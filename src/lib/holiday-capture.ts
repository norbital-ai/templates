/** The runs whose frozen `holidays` snapshot still captures a holiday: shared by the write and the delete grant. */
export type HolidayCapturingRun = {
	readonly id: string;
	readonly period: string;
	readonly holidays: ReadonlyArray<{ readonly id: string }> | null;
};

export function capturingRuns(
	runs: readonly HolidayCapturingRun[],
	holidayId: string
): HolidayCapturingRun[] {
	return runs.filter((run) => (run.holidays ?? []).some((holiday) => holiday.id === holidayId));
}
