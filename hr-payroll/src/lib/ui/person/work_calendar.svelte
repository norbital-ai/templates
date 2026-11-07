<script lang="ts">
	import type { Row } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import {
		DescriptionHint,
		EventCalendar,
		type CalendarEvent,
		type CalendarView
	} from '@norbital-ai/ui';
	import { Cover } from '@norbital-ai/ui/layout';
	import { addDays, monthOf, eachDay, datePeriod } from '@norbital-ai/std/date';
	import { Schema } from 'effect';
	import { JsonObject } from '../../payroll_engine/contracts.js';
	import { scheduled, holidaysForDay } from '../../payroll_engine/attendance.js';
	import { cycleShiftId } from '../roster/month_board.js';
	import { getErrorMessage, jsonValues } from '../../payroll_engine/foundation.js';
	let {
		contract,
		company,
		employerVersions
	}: {
		contract: Row<'employee_contract'>;
		company: Pick<Row<'entity'>, 'id' | 'name' | 'settings_code'>;
		employerVersions: readonly Pick<
			Row<'entity_profile_version'>,
			'id' | 'entity_id' | 'effective_range' | 'status' | 'time_zone'
		>[];
	} = $props();
	const clock = bolt.clock('minute');
	const initialDay = clock.today || new Date().toISOString().slice(0, 10);
	let at = $state(new Date(`${initialDay}T12:00:00`));
	let view = $state<CalendarView>('month');
	const month = $derived(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`);
	const monthEnd = $derived.by(() => {
		const end = monthOf(`${month}-01`).to;
		if (end == null) throw new Error('A calendar month requires its closing date.');
		return end;
	});
	const from = $derived(addDays(`${month}-01`, -7));
	const to = $derived(addDays(monthEnd, 7));
	const versions = $derived(
		bolt.query({
			employee_contract: {
				where: {
					employee_id: { eq: contract.employee_id },
					entity_id: { eq: company.id },
					status: { eq: 'SEALED' }
				},
				limit: 10000
			}
		})
	);
	const ids = $derived((versions.current?.employee_contract.rows ?? []).map((r) => r.id));
	const holidays = $derived(
		bolt.query({
			holiday: {
				where: {
					entity_id: { eq: company.id },
					date: { gte: from, lte: to },
					published_at: { isNull: false }
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
		bolt.query({
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
				limit: 10000
			},
			jurisdiction_settings: {
				where: { code: { eq: company.settings_code }, status: { eq: 'SEALED' } },
				fields: ['effective_range', 'timezone'],
				limit: 10000
			}
		})
	);
	const rosterDays = $derived(data.current?.roster_entry.rows ?? []);
	const error = $derived(versions.error?.message ?? holidays.error?.message ?? data.error?.message);
	const loading = $derived(
		versions.current == null || holidays.current == null || data.current == null
	);
	const incomplete = $derived(
		versions.current?.employee_contract.next != null ||
			holidays.current?.holiday.next != null ||
			data.current?.roster_entry.next != null ||
			data.current?.shift_definition.next != null ||
			data.current?.shift_pattern.next != null ||
			data.current?.leave_catalog_entry.next != null ||
			data.current?.jurisdiction_settings.next != null
	);
	const covers = (range: { from: string; to: string | null }, date: string) =>
		range.from <= date && (range.to == null || range.to >= date);
	const zoneOn = (date: string): string | null =>
		employerVersions.find((v) => covers(v.effective_range, date))?.time_zone ??
		data.current?.jurisdiction_settings.rows.find((v) => covers(v.effective_range, date))
			?.timezone ??
		null;
	const timeZone = $derived(zoneOn(`${month}-01`) ?? zoneOn(monthEnd));
	const stamp = (date: string) => new Date(`${date}T00:00:00`);
	const local = (instant: number | string, zone: string): Date => {
		const parts = new Map(
			new Intl.DateTimeFormat('en-CA', {
				timeZone: zone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hourCycle: 'h23'
			})
				.formatToParts(new Date(instant))
				.map((p) => [p.type, p.value])
		);
		return new Date(
			`${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`
		);
	};
	const presentation = $derived.by(() => {
		const events: CalendarEvent[] = [];
		if (loading || error || incomplete || timeZone == null || data.current == null)
			return { events, error: null };
		try {
			const native = Schema.decodeUnknownSync(
				Schema.Record(Schema.String, Schema.Array(JsonObject))
			)(
				jsonValues({
					employee_contract: versions.current?.employee_contract.rows ?? [],
					roster_entry: rosterDays,
					shift_definition: data.current.shift_definition.rows,
					holiday: holidays.current?.holiday.rows ?? []
				})
			);
			const selected = rosterDays;
			const plans = selected.map((row) => {
				const date = String(row.work_date),
					zone = zoneOn(date);
				if (zone == null) throw new Error(bolt.t('app.hr_employee.calendar_zone_missing'));
				const shift = native.shift_definition?.find((s) => s.id === row.shift_definition_id);
				return {
					row,
					date,
					zone,
					plan: scheduled(row, { zone, ...(shift == null ? {} : { shift }) })
				};
			});
			const dayTypes = Object.fromEntries(plans.map((p) => [p.date, p.plan.day_type]));
			const leave = data.current.leave_catalog_entry.rows.filter((row) => row.reverses == null);
			for (const date of eachDay(datePeriod(from, to)).map(String)) {
				if (
					!(versions.current?.employee_contract.rows ?? []).some((c) =>
						covers(c.effective_range, date)
					)
				)
					continue;
				const observed = holidaysForDay(date, {
					holidays: native.holiday ?? [],
					roster_day_types: dayTypes,
					roster_days: selected
				});
				for (const holiday of observed)
					events.push({
						id: `ph:${holiday.id}`,
						title: `${bolt.t('roster.public_holiday')}: ${holiday.name}`,
						start: stamp(date),
						end: stamp(String(addDays(date, 1))),
						allDay: true,
						color: 'var(--chart-4)'
					});
				const work = plans.find((p) => p.date === date);
				const absent = leave.some((row) => row.days.some((day) => day.date === date));
				// no roster row yet: the contract valid that day projects its pattern
				const valid = (versions.current?.employee_contract.rows ?? []).find((c) =>
					covers(c.effective_range, date)
				);
				const patternId = valid?.terms?.shift_pattern_id;
				const projectedId =
					work != null || patternId == null
						? null
						: cycleShiftId(
								data.current.shift_pattern.rows.find((row) => row.id === patternId),
								date
							);
				const projected = native.shift_definition?.find((s) => s.id === projectedId);
				const projectedZone = zoneOn(date);
				if (projected != null && projectedZone != null && observed.length === 0 && !absent) {
					const plan = scheduled({ work_date: date }, { zone: projectedZone, shift: projected });
					const first = plan.spans[0],
						last = plan.spans.at(-1);
					if (plan.day_type === 'WORK')
						events.push({
							id: `projected:${date}`,
							title: bolt.t('roster.plan_projected'),
							start: first == null ? stamp(date) : local(first.start, projectedZone),
							end: last == null ? stamp(String(addDays(date, 1))) : local(last.end, projectedZone),
							allDay: first == null,
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
								? bolt.t('app.hr_employee.calendar_work')
								: work.plan.day_type,
						start: first == null ? stamp(date) : local(first.start, work.zone),
						end: last == null ? stamp(String(addDays(date, 1))) : local(last.end, work.zone),
						allDay: first == null,
						color: work.plan.day_type === 'WORK' ? 'var(--chart-1)' : 'var(--muted-foreground)'
					});
				}
				for (const [index, interval] of (
					rosterDays.find((r) => r.id === work?.row.id)?.actual_worked_intervals ?? []
				).entries()) {
					if (interval.end == null || work == null) continue;
					events.push({
						id: `clock:${work.row.id}:${index}`,
						title: bolt.t('app.hr_employee.calendar_attendance'),
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
						end: stamp(String(addDays(day.date, 1))),
						allDay: true,
						color: 'var(--chart-3)'
					});
				}
			};
			for (const row of leave) addLeave(row.id, row.catalog_id, row.days);
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
			{bolt.t('app.hr_employee.calendar_incomplete')}
		</p>
	{:else if !loading && timeZone == null}<p role="alert" class="text-sm text-destructive">
			{bolt.t('app.hr_employee.calendar_zone_missing')}
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
			events={presentation.events}
			{view}
			date={at}
			readonly
			onDateChange={(next) => (at = next)}
			onViewChange={(next) => (view = next)}
		>
			{#snippet actions()}<DescriptionHint
					text={bolt.t('app.hr_employee.calendar_readonly', { zone: timeZone ?? 'UTC' })}
				/>{/snippet}
		</EventCalendar>{/if}
</Cover>
