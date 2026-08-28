/**
 * Turns one sheet's half-days into the mixed create/update rows an import pipeline returns.
 *
 * Identity is complete on both arms. A new person-day names its natural-key columns and lets the
 * platform assign its stable import identity; an existing one additionally names the stored `id`,
 * which is the import contract's update assertion. No write happens here — hooks, policy and commit
 * all remain on the platform's canonical mutation path after the pipeline returns.
 */

type PersonDayWrite<Values extends object> = Readonly<{
	readonly employment_id: string;
	readonly work_date: string;
	readonly values: Values;
}>;

type PersonDayMutation<Values extends object> = Values &
	Readonly<{
		readonly id?: string;
		readonly employment_id: string;
		readonly work_date: string;
	}>;

export const personDayMutations = <Values extends object>(
	existing: ReadonlyMap<string, Readonly<{ readonly id: string }>>,
	rows: readonly PersonDayWrite<Values>[],
	keyOf: (employmentId: string, workDate: string) => string
): ReadonlyArray<PersonDayMutation<Values>> =>
	rows.map((row) => {
		const stored = existing.get(keyOf(row.employment_id, row.work_date));
		return {
			...row.values,
			...(stored === undefined ? {} : { id: stored.id }),
			employment_id: row.employment_id,
			work_date: row.work_date
		};
	});
