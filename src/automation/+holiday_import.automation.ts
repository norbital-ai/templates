import { automation, type Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { googleHolidayRows, holidaySources, readGoogleHolidayYear } from '../lib/holiday-import.js';
import {dedupeHolidayRows} from '../lib/payroll_engine/catalogues/holiday-rows.js';
import {getErrorMessage} from '../lib/payroll_engine/foundation/primitives.js';

const outcome = {
	kind: 'object',
	fields: {
		company_id: { kind: 'text' },
		year: { kind: 'int' },
		inserted: { kind: 'int' },
		skipped: { kind: 'int' }
	}
} as const;

/**
 * Reads one entity's Google holiday calendar for a year and adds the days it does not have yet, unpublished. It
 * iterates entities, not jurisdictions: two entities in one country each get their own read and their own rows.
 * A day the entity already has (published, captured or a draft) is skipped, never overwritten; a day repeated in
 * the feed is last-wins.
 */
const holiday_import = automation({
	description:
		'Every 1 October, reads each entity’s enabled Google holiday calendar for next year and adds the days that entity does not have yet, unpublished. Manual runs choose an entity and a year. It never publishes, changes or deletes a holiday.',
	on: { cron: '0 3 1 10 *' },
	input: {
		company_id: { kind: 'id', of: 'entities', optional: true },
		year: { kind: 'int', min: 1, max: 9998, optional: true }
	},
	output: { kind: 'object', fields: { imports: { kind: 'list', of: outcome } } },
	runAs: ['holiday_import_automation'],
	concurrency: { max: 1 }
});
export default holiday_import;

holiday_import.run(async (input, ctx) => {
	const { rows: entities } = await ctx.read('entities', {
		where: {
			approval_id: { isNull: true },
			...(input.company_id == null ? {} : { id: { eq: input.company_id } })
		},
		select: { id:true,name: true, settings_code: true, holiday_source: true },
		all: true
	});
	const sources = holidaySources(entities, input.company_id ?? undefined);
	if (input.company_id != null && sources.length === 0)
		throw new Error(
			'No Google holiday calendar is known for this entity. Set one on the entity before importing.'
		);
	const imports = [];
	for (const [index, source] of sources.entries()) {
		const year =
			input.year ?? Number.parseInt(String(ctx.todayIn(source.time_zone)).slice(0, 4), 10) + 1;
		await ctx.progress({
			ratio: index / sources.length,
			text: `Reading ${source.company_name} holidays for ${year}`
		});
		const events = await Effect.runPromise(
			readGoogleHolidayYear(source, year, (request) =>
				Effect.tryPromise({try:() =>
					ctx.http('google_calendar').get(request.path, {
						query: request.query,
						output: { kind: 'json' }
					}),catch:error=>new Error(getErrorMessage(error))
				})
			)
		);
		const proposed=googleHolidayRows(source.company_id,events);
		const {inserts,reconciliation}=await dedupeHolidayRows(ctx,proposed,message=>{throw new Error(message);});
		if (inserts.length > 0)
			await ctx.act(
				'holidays.create',
				inserts.map((row) => ({
					company_id: row.company_id as Id<'entities'>,
					date: PlainDate(row.date),
					name: row.name,
					source: row.source
				}))
			);
		imports.push({
			company_id: source.company_id,
			year,
			inserted: inserts.length,
			skipped: reconciliation.filter(row=>row.reason==='ALREADY_PRESENT').length
		});
	}
	const inserted = imports.reduce((sum, row) => sum + row.inserted, 0);
	const skipped = imports.reduce((sum, row) => sum + row.skipped, 0);
	await ctx.progress({
		ratio: 1,
		text: `Imported ${inserted} holidays; ${skipped} already present. Publish the ones to observe.`
	});
	return { imports };
});
