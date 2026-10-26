<script lang="ts">
	/**
	 * One person-day: what the calendar projects, what the roster plans and what the clock recorded, in the record's
	 * own form. The board opens a day only projected as a new entry for its person and date; a day settled on a payslip
	 * shows, never edits.
	 */
	import { bolt } from '$bolt';
	import { Schema } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	import { isPlainDate } from '@norbital-ai/std/date';
	import { inputSchema } from '@norbital-ai/std/kind';
	import { Form, openRecord, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { governingVersion } from '../../../lib/ui/person/governing_version.svelte.js';
	import { employmentLabel, entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import { createValues } from '../../../lib/ui/scopes/create_values.js';
	import { formatCalendarDate } from '../../../lib/ui/format/display_formatters.js';
	import { plannedShiftOf } from '../../../lib/ui/roster/shift_code.js';
	import {
		buildDays,
		dayKey,
		holidayRead,
		leaveRead,
		patternRead,
		shiftRead
	} from '../../../lib/ui/roster/month_board.js';
	import DayFields from '../../../lib/ui/roster/day_fields.svelte';

	let { view }: { view: RecordView<'roster_entry'> } = $props();
	// opened from the board for a projected day: its person and date
	const preset = createValues();
	const employmentIdSchema = inputSchema({ kind: 'id', of: 'employment_contract' });
	const isEmploymentId = (value: unknown): value is Id<'employment_contract'> =>
		Schema.is(employmentIdSchema)(value);

	const record = $derived(view.mode !== 'create' ? view.record : null);
	// a new day has no attendance recorded yet, not a reviewed empty one
	const values = $derived(
		view.mode === 'create'
			? { worked_intervals: null, approved_overtime_intervals: null, ...preset, ...view.values }
			: {}
	);
	const employmentId = $derived.by(() => {
		const held =
			view.mode === 'create'
				? (view.values['employment_id'] ?? preset['employment_id'])
				: undefined;
		return record?.employment_id ?? (isEmploymentId(held) ? held : null);
	});
	const date = $derived.by(() => {
		const held =
			view.mode === 'create' ? (view.values['work_date'] ?? preset['work_date']) : undefined;
		return record != null ? String(record.work_date).slice(0, 10) : isPlainDate(held) ? held : null;
	});

	const contract = $derived.by(() =>
		employmentId == null
			? null
			: bolt.query('employment_contract', {
					where: { id: { eq: employmentId } },
					select: {
						company_id: true,
						employee_number: true,
						employee_id: { select: { name: true } },
						effective_range: true,
						facts: true
					},
					limit: 1
				})
	);
	const employment = $derived(contract?.current?.rows?.[0] ?? null);
	const companyId = $derived(employment?.company_id ?? null);
	const entity = $derived.by(() =>
		companyId == null ? null : bolt.query('entity', { id: companyId, select: { time_zone: true } })
	);
	const version = governingVersion(
		() => companyId,
		() => date
	);
	const timeZone = $derived(entityTimeZone(entity?.current, version.current));
	const policy = $derived(version.current?.payroll?.attendance ?? null);
	const holidays = $derived.by(() =>
		companyId == null || date == null ? null : holidayRead(companyId, date, date)
	);
	const leave = $derived.by(() =>
		employmentId == null || date == null ? null : leaveRead([employmentId], date, date)
	);
	const shifts = $derived.by(() => (companyId == null ? null : shiftRead(companyId)));
	const patterns = $derived.by(() => (companyId == null ? null : patternRead(companyId)));
	const shiftOf = $derived(
		plannedShiftOf({
			contracts: employment == null ? [] : [employment],
			definitions: shifts?.current?.rows ?? [],
			patterns: patterns?.current?.rows ?? []
		})
	);
	/** The stored day as the board draws it: the projection, leave, holiday and payroll lock. */
	const day = $derived.by(() => {
		if (
			employment == null ||
			date == null ||
			holidays?.current?.rows === undefined ||
			leave?.current?.rows === undefined ||
			shifts?.current?.rows === undefined ||
			patterns?.current?.rows === undefined
		)
			return null;
		return (
			buildDays({
				dates: [date],
				people: [
					{
						id: employment.id,
						from: String(employment.effective_range.from),
						to: employment.effective_range.to == null ? null : String(employment.effective_range.to)
					}
				],
				entries: record == null ? [] : [record],
				holidays: holidays?.current?.rows,
				leave: leave?.current?.rows,
				timeZone,
				policy,
				shiftOf
			}).get(dayKey(employment.id, date)) ?? null
		);
	});
	const heading = $derived(
		employment == null || date == null
			? {}
			: { title: `${employmentLabel(employment)} · ${formatCalendarDate(date)}` }
	);
</script>

<RecordShell
	of="roster_entry"
	mode={view.mode}
	{...record == null ? { values } : { id: record.id }}
	{...heading}
>
	{#key record?.revision}
		<Form
			of="roster_entry"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			readonly={day?.locked === true}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.collection === 'roster_entry');
				if (created) openRecord('roster_entry', created.id);
			}}
		>
			{#snippet children(form)}
				{#if day == null || employment == null || companyId == null}
					<p class="text-meta">{bolt.t('component.loading')}</p>
				{:else}
					{@const employmentId = employment.id}
					{@const on = day.date}
					<DayFields
						{form}
						{day}
						{companyId}
						{timeZone}
						{policy}
						planOf={(shift) => shiftOf(employmentId, on, shift)}
					/>
				{/if}
			{/snippet}
		</Form>
	{/key}
</RecordShell>
