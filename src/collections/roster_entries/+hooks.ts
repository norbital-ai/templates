import { rosterCodeVariantSchema } from '../../custom-types/roster_code_variant/+definition.js';
import type { HookApi, Hooks } from './$types.js';

function dateKey(value: string | Date | null | undefined): string {
	if (value == null) return '';
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function rangeCovers(
	range: { readonly start?: string | Date; readonly end?: string | Date } | null,
	date: string
): boolean {
	if (range?.start == null) return false;
	return date >= dateKey(range.start) && (range.end == null || date <= dateKey(range.end));
}

type AssignmentValue = {
	readonly employment_id: string;
	readonly work_date: string | Date;
	readonly shift_definition_id: string;
	readonly roster_id: string | null;
};

type EmploymentReference = { readonly company_id: string };
type RosterCodeReference = {
	readonly company_id: string;
	readonly code: string;
	readonly variant: unknown;
	readonly effective_range: { readonly start?: string | Date; readonly end?: string | Date } | null;
};
type RosterReference = {
	readonly company_id: string;
	readonly month: string;
	readonly published_at: string | Date | null;
};

function assertResolvedAssignment(
	value: AssignmentValue,
	employment: EmploymentReference | null | undefined,
	code: RosterCodeReference | null | undefined,
	roster: RosterReference | null | undefined
): void {
	const date = dateKey(value.work_date);
	if (employment == null)
		throw new Error('The employment for this roster assignment no longer exists.');
	if (code == null) throw new Error('Choose a roster code that still exists.');
	rosterCodeVariantSchema.parse(code.variant);
	if (code.company_id !== employment.company_id) {
		throw new Error(`Roster code ${code.code} belongs to another legal entity.`);
	}
	if (!rangeCovers(code.effective_range, date)) {
		throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
	}
	if (value.roster_id == null) return;
	if (roster == null) throw new Error('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		throw new Error(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
	if (roster.company_id !== employment.company_id) {
		throw new Error('The employee and monthly roster belong to different legal entities.');
	}
	if (!date.startsWith(`${roster.month}-`)) {
		throw new Error(`${date} does not belong to roster ${roster.month}.`);
	}
}

async function assertRosterOpen(api: HookApi, rosterId: string | null | undefined): Promise<void> {
	if (rosterId == null) return;
	const roster = await api.db.query.rosters.findFirst({
		where: { norbital_id: { eq: rosterId } },
		columns: { month: true, published_at: true }
	});
	if (roster == null) throw new Error('The draft roster for this assignment no longer exists.');
	if (roster.published_at != null) {
		throw new Error(
			`Roster ${roster.month} is published, so its assignments are fixed. Re-open the month before changing it.`
		);
	}
}

async function assertAssignment(api: HookApi, value: AssignmentValue): Promise<void> {
	const [employment, code, roster] = await Promise.all([
		api.db.query.employments.findFirst({
			where: { norbital_id: { eq: value.employment_id } },
			columns: { company_id: true }
		}),
		api.db.query.shift_definitions.findFirst({
			where: { norbital_id: { eq: value.shift_definition_id } },
			columns: { company_id: true, code: true, variant: true, effective_range: true }
		}),
		value.roster_id == null
			? Promise.resolve(null)
			: api.db.query.rosters.findFirst({
					where: { norbital_id: { eq: value.roster_id } },
					columns: { company_id: true, month: true, published_at: true }
				})
	]);
	assertResolvedAssignment(value, employment, code, roster);
}

export default {
	create: {
		before: {
			description:
				'Refuses assignments in a published month and verifies the roster code is valid for the employment, legal entity and work date.',
			batchHandler: async ({ inputs, api }) => {
				const employmentIds = [...new Set(inputs.map((input) => input.employment_id))];
				const codeIds = [...new Set(inputs.map((input) => input.shift_definition_id))];
				const rosterIds = [
					...new Set(inputs.flatMap((input) => (input.roster_id ? [input.roster_id] : [])))
				];
				const [employments, codes, rosters] = await Promise.all([
					api.db.query.employments.findMany({
						where: { norbital_id: { in: employmentIds } },
						columns: { norbital_id: true, company_id: true },
						limit: Math.max(1, employmentIds.length)
					}),
					api.db.query.shift_definitions.findMany({
						where: { norbital_id: { in: codeIds } },
						columns: {
							norbital_id: true,
							company_id: true,
							code: true,
							variant: true,
							effective_range: true
						},
						limit: Math.max(1, codeIds.length)
					}),
					rosterIds.length
						? api.db.query.rosters.findMany({
								where: { norbital_id: { in: rosterIds } },
								columns: {
									norbital_id: true,
									company_id: true,
									month: true,
									published_at: true
								},
								limit: Math.max(1, rosterIds.length)
							})
						: []
				]);
				const employmentsById = new Map(
					employments.map((employment) => [employment.norbital_id, employment])
				);
				const codesById = new Map(codes.map((code) => [code.norbital_id, code]));
				const rostersById = new Map(rosters.map((roster) => [roster.norbital_id, roster]));
				for (const input of inputs) {
					const rosterId = input.roster_id ?? null;
					assertResolvedAssignment(
						{
							employment_id: input.employment_id,
							work_date: input.work_date,
							shift_definition_id: input.shift_definition_id,
							roster_id: rosterId
						},
						employmentsById.get(input.employment_id),
						codesById.get(input.shift_definition_id),
						rosterId == null ? null : rostersById.get(rosterId)
					);
				}
				return inputs;
			},
			handler: async ({ input, api }) => {
				await assertRosterOpen(api, input.roster_id);
				await assertAssignment(api, {
					employment_id: input.employment_id,
					work_date: input.work_date,
					shift_definition_id: input.shift_definition_id,
					roster_id: input.roster_id ?? null
				});
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Refuses edits in a published month and validates the complete resulting roster-code assignment.',
			handler: async ({ input, existing, api }) => {
				await assertRosterOpen(api, existing.roster_id);
				if (input.roster_id != null && input.roster_id !== existing.roster_id) {
					await assertRosterOpen(api, input.roster_id);
				}
				await assertAssignment(api, {
					employment_id: input.employment_id ?? existing.employment_id,
					work_date: input.work_date ?? existing.work_date,
					shift_definition_id: input.shift_definition_id ?? existing.shift_definition_id,
					roster_id: input.roster_id === undefined ? existing.roster_id : input.roster_id
				});
				return input;
			}
		}
	},
	delete: {
		before: {
			description: 'Refuses to remove an assignment from a published monthly roster.',
			handler: async ({ existing, api }) => {
				await assertRosterOpen(api, existing.roster_id);
			}
		}
	}
} satisfies Hooks;
