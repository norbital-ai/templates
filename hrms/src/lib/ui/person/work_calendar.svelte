<script lang="ts">
	import type { Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		DescriptionHint,
		EventCalendar,
		type CalendarEvent,
		type CalendarView
	} from '@norbital-ai/ui';
	import { Cover } from '@norbital-ai/ui/layout';
	import { DateTime, Duration, Schema } from 'effect';
	import { JsonObject } from '../../payroll_engine/contracts.js';
	import { scheduled, holidaysForDay } from '../../payroll_engine/attendance.js';
	import { cycleShiftId } from '../roster/month_board.js';
	import { inForce } from '../../dated.js';
	import { termsChange } from '../../person.js';
	import { getErrorMessage, jsonObject, jsonValues } from '../../payroll_engine/foundation.js';
	let {
		ctx,
		employment,
		company
	}: {
		ctx: PageContext;
		employment: Pick<Row<'employment'>, 'employee_id'>;
		company: Pick<Row<'entity'>, 'id' | 'name' | 'settings_code' | 'time_zone'>;
	} = $props();
	const clock = ctx.clock('minute');
	let at = $state(new Date(`${clock.today}T12:00:00`));
	let view = $state<CalendarView>('month');
	// the calendar's date is the viewer's wall time
	const monthStart = $derived(
		DateTime.startOf(DateTime.makeZonedUnsafe(at, { timeZone: DateTime.zoneMakeLocal() }), 'month')
	);
	const monthEnd = $derived(DateTime.formatIsoDate(DateTime.endOf(monthStart, 'month')));
	const from = $derived(DateTime.formatIsoDate(DateTime.subtract(monthStart, { days: 7 })));
	const to = $derived(
		DateTime.formatIsoDate(DateTime.add(DateTime.endOf(monthStart, 'month'), { days: 7 }))
	);
	const stints = $derived(
		ctx.query({
			employment: {
				where: { employee_id: { eq: employment.employee_id }, entity_id: { eq: company.id } },
				fields: ['effective_range'],
				limit: 10000,
				terms: { fields: ['effective_from', 'shift_pattern_id', 'clears'], limit: 10000 }
			}
		})
	);
	const ids = $derived((stints.current?.employment.rows ?? []).map((r) => r.id));
	const holidays = $derived(
		ctx.query({
			holiday: {
				where: {
					entity_id: { eq: company.id },
					date: { gte: from, lte: to },
					published_at: { is_null: false },
					employee_id: { is_null: true }
				},
				fields: ['date', 'name', 'published_at', 'replaces', 'given_to', 'entity_id'],
				limit: 10000
			}
		})
	);
	const replaced = $derived(
		(holidays.current?.holiday.rows ?? []).flatMap((h) => (h.replaces == null ? [] : [h.replaces]))
	);
	const data = $derived(
		ctx.query({
			roster_entry: {
				where: {
					employment_id: { in: ids },
					or: [{ work_date: { gte: from, lte: to } }, { work_date: { in: replaced } }]
				},
				limit: 10000
			},
			shift_definition: { where: { entity_id: { eq: company.id } }, limit: 10000 },
			shift_pattern: {
				where: { entity_id: { eq: company.id } },
				fields: ['pattern', 'effective_range'],
				limit: 10000
			},
			leave_catalog_entry: {
				where: { employment_id: { in: ids } },
				limit: 10000,
				leave_catalog_entry_day: {
					fields: ['incurred_on', 'part'],
					limit: 10000
				}
			},
			jurisdiction: {
				where: { code: { eq: company.settings_code } },
				fields: ['timezone'],
				limit: 1
			}
		})
	);
	const rosterDays = $derived(data.current?.roster_entry.rows ?? []);
	const error = $derived(stints.error?.message ?? holidays.error?.message ?? data.error?.message);
	const loading = $derived(
		stints.current == null || holidays.current == null || data.current == null
	);
	const incomplete = $derived(
		stints.current?.employment.next != null ||
			holidays.current?.holiday.next != null ||
			data.current?.roster_entry.next != null ||
			data.current?.shift_definition.next != null ||
			data.current?.shift_pattern.next != null ||
			data.current?.leave_catalog_entry.next != null ||
			data.current?.jurisdiction.next != null
	);
	const covers = (range: { from: string; to: string | null }, date: string) =>
		range.from <= date && (range.to == null || range.to >= date);
	const timeZone = $derived(
		company.time_zone ?? data.current?.jurisdiction.rows[0]?.timezone ?? null
	);
	const stamp = (date: string) => new Date(`${date}T00:00:00`);
	// EventCalendar draws Dates in the viewer's zone and takes none: a zone's wall time as the viewer's
	const local = (instant: number | string, zone: string): Date =>
		DateTime.toDateUtc(
			DateTime.makeZonedUnsafe(
				DateTime.toParts(DateTime.makeZonedUnsafe(instant, { timeZone: zone })),
				{
					timeZone: DateTime.zoneMakeLocal(),
					adjustForTimeZone: true
				}
			)
		);
	const presentation = $derived.by(() => {
		const events: CalendarEvent[] = [];
		if (loading || error || incomplete || timeZone == null || data.current == null)
			return { events, error: null };
		try {
			const native = Schema.decodeUnknownSync(
				Schema.Record(Schema.String, Schema.Array(JsonObject))
			)(
				jsonValues({
					roster_entry: rosterDays,
					shift_definition: data.current.shift_definition.rows,
					holiday: holidays.current?.holiday.rows ?? []
				})
			);
			const selected = rosterDays;
			const plans = selected.map((row) => {
				const date = String(row.work_date),
					zone = timeZone;
				if (zone == null) throw new Error(ctx.t('app.hr_employee.calendar_zone_missing'));
				const shift = native.shift_definition?.find((s) => s.id === row.shift_definition_id);
				return {
					row,
					date,
					zone,
					plan: scheduled(row, { zone, ...(shift == null ? {} : { shift }) })
				};
			});
			const dayTypes = Object.fromEntries(plans.map((p) => [p.date, p.plan.day_type]));
			const leave = data.current.leave_catalog_entry.rows.map((row) => ({
				...row,
				days: (row.leave_catalog_entry_day ?? []).map((child) => ({
					date: String(child.incurred_on),
					part: String(child.part)
				}))
			}));
			const fromDay = DateTime.makeUnsafe(from);
			const span = Duration.toDays(DateTime.distance(fromDay, DateTime.makeUnsafe(to))) + 1;
			for (const date of Array.from({ length: span }, (_, day) =>
				DateTime.formatIsoDateUtc(DateTime.add(fromDay, { days: day }))
			)) {
				if (!(stints.current?.employment.rows ?? []).some((c) => covers(c.effective_range, date)))
					continue;
				const observed = holidaysForDay(date, {
					holidays: native.holiday ?? [],
					roster_day_types: dayTypes,
					roster_days: selected
				});
				for (const holiday of observed)
					events.push({
						id: `ph:${holiday.id}`,
						title: `${ctx.t('roster.public_holiday')}: ${holiday.name}`,
						start: stamp(date),
						end: stamp(
							DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { days: 1 }))
						),
						all_day: true,
						color: 'var(--chart-4)'
					});
				const work = plans.find((p) => p.date === date);
				const absent = leave.some((row) => row.days.some((day) => day.date === date));
				// no roster row yet: the terms in force that day project their pattern
				const valid = (stints.current?.employment.rows ?? []).find((c) =>
					covers(c.effective_range, date)
				);
				const patternId = inForce((valid?.terms ?? []).map(jsonObject).map(termsChange), date).state
					.shift_pattern_id;
				const projectedId =
					work != null || patternId == null
						? null
						: cycleShiftId(
								data.current.shift_pattern.rows.find((row) => row.id === patternId),
								date
							);
				const projected = native.shift_definition?.find((s) => s.id === projectedId);
				const projectedZone = timeZone;
				if (projected != null && projectedZone != null && observed.length === 0 && !absent) {
					const plan = scheduled({ work_date: date }, { zone: projectedZone, shift: projected });
					const first = plan.spans[0],
						last = plan.spans.at(-1);
					if (plan.day_type === 'WORK')
						events.push({
							id: `projected:${date}`,
							title: ctx.t('roster.plan_projected'),
							start: first == null ? stamp(date) : local(first.start, projectedZone),
							end:
								last == null
									? stamp(
											DateTime.formatIsoDateUtc(
												DateTime.add(DateTime.makeUnsafe(date), { days: 1 })
											)
										)
									: local(last.end, projectedZone),
							all_day: first == null,
							color: 'var(--muted-foreground)'
						});
				}
				if (work != null && observed.length === 0 && !absent) {
					const first = work.plan.spans[0],
						last = work.plan.spans.at(-1);
					events.push({
						id: `plan:${work.row.id}`,
						title:
							work.plan.day_type === 'WORK'
								? ctx.t('app.hr_employee.calendar_work')
								: work.plan.day_type,
						start: first == null ? stamp(date) : local(first.start, work.zone),
						end:
							last == null
								? stamp(
										DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { days: 1 }))
									)
								: local(last.end, work.zone),
						all_day: first == null,
						color: work.plan.day_type === 'WORK' ? 'var(--chart-1)' : 'var(--muted-foreground)'
					});
				}
				for (const [index, interval] of (
					rosterDays.find((r) => r.id === work?.row.id)?.actual_worked_intervals ?? []
				).entries()) {
					if (interval.end == null || work == null) continue;
					events.push({
						id: `clock:${work.row.id}:${index}`,
						title: ctx.t('app.hr_employee.calendar_attendance'),
						start: local(interval.start, work.zone),
						end: local(interval.end, work.zone),
						color: 'var(--chart-2)'
					});
				}
			}
			const addLeave = (
				id: string,
				title: string,
				days: readonly { date: string; part: string }[]
			) => {
				for (const [index, day] of days.entries()) {
					if (day.date < from || day.date > to) continue;
					events.push({
						id: `leave:${id}:${index}`,
						title: `${title} · ${day.part}`,
						start: stamp(day.date),
						end: stamp(
							DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(day.date), { days: 1 }))
						),
						all_day: true,
						color: 'var(--chart-3)'
					});
				}
			};
			for (const row of leave) addLeave(row.id, row.catalog_code, row.days);
			return { events, error: null };
		} catch (cause) {
			return { events: [], error: getErrorMessage(cause) };
		}
	});
</script>

<Cover gap="sm" size="fill">
	{#if error || presentation.error}<p role="alert" class="text-sm text-destructive">
			{error ?? presentation.error}
		</p>
	{:else if incomplete}<p role="alert" class="text-sm text-destructive">
			{ctx.t('app.hr_employee.calendar_incomplete')}
		</p>
	{:else if !loading && timeZone == null}<p role="alert" class="text-sm text-destructive">
			{ctx.t('app.hr_employee.calendar_zone_missing')}
		</p>
	{:else}{@const warnings = rosterDays.flatMap((row) =>
			Array.isArray(row.findings) ? row.findings : []
		)}
		{#if warnings.length > 0}<ul
				role="status"
				class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
			>
				{#each warnings as warning}<li>{warning.message}</li>{/each}
			</ul>{/if}<EventCalendar
			{ctx}
			events={presentation.events}
			{view}
			date={at}
			readonly
			on_date_change={(next) => (at = next)}
			on_view_change={(next) => (view = next)}
		>
			{#snippet actions()}<DescriptionHint
					text={ctx.t('app.hr_employee.calendar_readonly', { zone: timeZone ?? 'UTC' })}
				/>{/snippet}
		</EventCalendar>{/if}
</Cover>
