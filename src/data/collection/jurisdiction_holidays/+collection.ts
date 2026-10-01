import { collection, type Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { dedupeHolidayRows, type HolidayImportRow } from '../../../lib/holiday-rows.js';
import { formatNamedList } from '../../../lib/period.js';
import { compileEligibility } from '../../../lib/payroll/run/eligibility.js';

/** Holidays. A holiday a payroll run captured is history (the delete guard). */
const holidays = collection('jurisdiction_holidays', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'company_id',
				'date',
				'name',
				'kind',
				'replaces',
				'given_to',
				'worksite',
				'religion',
				'applies_when',
				'source',
				'published_at'
			]
		}
	},
	update: {
		input: {
			columns: [
				'company_id',
				'date',
				'name',
				'kind',
				'replaces',
				'given_to',
				'worksite',
				'religion',
				'applies_when',
				'source',
				'published_at'
			]
		}
	},
	delete: { transform: true },
	actions: {
		import_workbook: {
			description:
				'Loads company-wide holidays from the holidays spreadsheet — one row per entity and day, and one file may carry every entity; a day the entity already has company-wide is skipped, never duplicated or overwritten, and imported rows arrive unpublished. An unmatched entity is refused by name; a duplicated day and a day already on file are reported.',
			input: {
				rows: {
					kind: 'list',
					of: {
						kind: 'object',
						fields: {
							legal_entity: { kind: 'text' },
							date: { kind: 'text' },
							name: { kind: 'text' },
							replaces: { kind: 'text', optional: true },
							source: { kind: 'text', optional: true }
						}
					}
				}
			},
			output: {
				kind: 'object',
				fields: {
					inserted: { kind: 'int' },
					skipped: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								company_id: { kind: 'text' },
								date: { kind: 'text' },
								name: { kind: 'text' },
								reason: { kind: 'enum', values: ['DUPLICATE_IN_FILE', 'ALREADY_PRESENT'] }
							}
						}
					}
				}
			}
		}
	}
});
export default holidays;

/** The identity a pin or a run snapshot points at: what a retraction must not move. */
const IDENTITY = ['company_id', 'date', 'worksite'] as const;

/**
 * A holiday needs an entity, a day and a name, and its `applies_when` must compile as a person condition; retracting one (unpublish, or moving its day or entity) is refused while
 * a payroll run captured it, and so is deleting it.
 */
holidays.transform(async (inputs, { existing, db, refuse }) => {
	const retracting = inputs.flatMap((input, index) => {
		const stored = existing[index];
		if (stored == null) return [];
		if ('$delete' in input) return [stored];
		const unpublishing = input.published_at === null && stored.published_at != null;
		const moving = IDENTITY.some(
			(column) => input[column] !== undefined && input[column] !== stored[column]
		);
		return unpublishing || moving ? [stored] : [];
	});
	const runs =
		retracting.length === 0
			? []
			: (
					await db.read('payroll_runs', {
						where: { company_id: { in: [...new Set(retracting.map((row) => row.company_id))] } },
						all: true
					})
				).rows;
	// The run whose frozen `holidays` snapshot still captures a holiday.
	const capturing = (id: string) =>
		runs.find((run) => (run.holidays ?? []).some((holiday) => holiday.id === id));
	return inputs.map((input, index) => {
		const stored = existing[index];
		if ('$delete' in input) {
			const run = stored == null ? undefined : capturing(stored.id);
			if (run != null)
				refuse(
					`Holiday ${String(stored!.date)} was captured by payroll run ${run.period} and cannot be deleted. ` +
						'Delete that draft run to release it; a paid run holds it permanently.'
				);
			return input;
		}
		if (!(input.name ?? stored?.name ?? '').trim())
			refuse('A holiday needs a name.', { field: 'name' });
		// A person condition is evaluated on every person-day that reads the calendar: refused here, not there.
		const fault = compileEligibility(input.applies_when);
		if (fault != null) refuse(`Applies when: ${fault}`, { field: 'applies_when' });
		// A blank worksite is the whole company, stored as null so the key sees one company-wide row a day.
		const row =
			input.worksite != null && !input.worksite.trim() ? { ...input, worksite: null } : input;
		if (stored == null || !retracting.includes(stored)) return row;
		const run = capturing(stored.id);
		if (run != null)
			refuse(
				`Holiday ${String(stored.date)} was captured by payroll run ${run.period} and cannot ` +
					`${input.published_at === null ? 'be unpublished' : 'move its day, entity or worksite'}. ` +
					'Delete that draft run to release it; a paid run holds it permanently.'
			);
		return row;
	});
});

/** The holidays spreadsheet: entity names resolved against the workspace, one file for every entity. */
holidays.action('import_workbook', async ({ rows }, ctx) => {
	const { rows: companies } = await ctx.read('companies', {
		select: { name: true, registration_number: true },
		all: true
	});
	// A sheet is named for its entity, and a spreadsheet sheet name stops at 31 characters, so an entity name longer
	// than that matches by its first 31 as well.
	const byName = new Map<string, Id<'companies'>[]>();
	for (const company of companies)
		for (const key of new Set(
			[company.name, company.name.slice(0, 31), company.registration_number]
				.filter((key): key is string => key != null && key.trim() !== '')
				.map((key) => key.trim().toLowerCase())
		))
			byName.set(key, [...(byName.get(key) ?? []), company.id]);
	// Every unmatched name at once: refusing on the first makes an operator fix a forty-entity file one typo per upload.
	const unmatched = [
		...new Set(
			rows
				.map((row) => row.legal_entity.trim())
				.filter((name) => (byName.get(name.toLowerCase()) ?? []).length !== 1)
		)
	];
	if (unmatched.length > 0)
		ctx.refuse(
			`These rows name an entity this workspace cannot resolve:\n${formatNamedList(unmatched)}\n` +
				`Known entities:\n${formatNamedList(companies.map((company) => company.name))}`
		);
	const proposed: HolidayImportRow[] = rows.map((row) => ({
		company_id: byName.get(row.legal_entity.trim().toLowerCase())![0]!,
		date: row.date,
		name: row.name,
		replaces: row.replaces ?? null,
		source: row.source ?? null
	}));
	const { inserts, reconciliation } = await dedupeHolidayRows(ctx, proposed, ctx.refuse);
	if (inserts.length > 0)
		await ctx.act(
			'jurisdiction_holidays.create',
			inserts.map((row) => ({
				company_id: row.company_id as Id<'companies'>,
				date: PlainDate(row.date),
				name: row.name,
				replaces: row.replaces == null ? null : PlainDate(row.replaces),
				source: row.source ?? 'spreadsheet'
			}))
		);
	return { inserted: inserts.length, skipped: reconciliation };
});
