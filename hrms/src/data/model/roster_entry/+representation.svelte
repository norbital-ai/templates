<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Badge,
		Button,
		Field,
		Form,
		Icon,
		Input,
		Label,
		Picker,
		RecordShell,
		Section,
		TimeInput,
		use_record_controller,
		type FieldEditor,
		type FieldView,
		type RecordView,
		type Value
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Stack, Surface } from '@norbital-ai/ui/layout';
	import { DateTime, Result } from 'effect';
	import { isJsonObject, jsonObject } from '../../../lib/foundation.js';
	import { idOf } from '../../../lib/reads.js';
	import { paidPeriods } from '../../../lib/ui/payroll/paid_period.svelte.js';
	import {
		clockStampOf,
		cycleShiftId,
		hoursLabel,
		shiftMinutes,
		workedMinutes,
		type ShiftRow
	} from '../../../lib/ui/roster/month_board.js';
	import { employmentOn } from '../employee_profile/service/person.js';

	type EditableInterval = {
		readonly start: string | null;
		readonly end: string | null;
		readonly break_minutes?: number;
		readonly breaks?: readonly { readonly start: string; readonly end: string }[];
	};

	let { view, ctx }: { view: RecordView<'roster_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const paid = paidPeriods(ctx);
	const clock = ctx.clock('day');
	const DAY = /^\d{4}-\d{2}-\d{2}$/;

	const lockedEmployment = $derived(
		record !== null || (view.mode === 'create' && view.values.employment_id != null)
	);
	const lockedDate = $derived(view.mode === 'create' && view.values.work_date != null);

	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const initialEmployment = $derived(
		record?.employment_id ??
			(view.mode === 'create' && typeof view.values.employment_id === 'string'
				? view.values.employment_id
				: null)
	);
	const initialDate = $derived(
		record?.work_date ??
			(view.mode === 'create' && typeof view.values.work_date === 'string'
				? view.values.work_date
				: null)
	);
	const employmentId = $derived.by(() => {
		const raw = liveForm?.get('employment_id');
		return typeof raw === 'string' ? raw : initialEmployment;
	});
	const workDate = $derived.by(() => {
		const raw = liveForm?.get('work_date');
		return typeof raw === 'string' ? raw : initialDate;
	});

	const stintQuery = $derived(
		employmentId === null
			? null
			: ctx.query({
					employment: {
						where: { id: { eq: idOf('employment', employmentId) } },
						fields: ['id', 'entity_id', 'employee_id', 'employee_number', 'effective_range'],
						limit: 1,
						entity_id: { fields: ['time_zone', 'settings_code'] },
						terms: { fields: ['effective_from', 'shift_pattern_id', 'clears'], limit: 10000 }
					}
				})
	);
	const stint = $derived(stintQuery?.current?.employment.rows[0] ?? null);
	const entityId = $derived(stint?.entity_id?.id ?? null);
	const employeeId = $derived(stint?.employee_id == null ? null : String(stint.employee_id));
	const timeZone = $derived(
		stint?.entity_id?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	);
	const validDate = $derived(workDate !== null && DAY.test(workDate) ? workDate : null);

	const contextQuery = $derived(
		entityId === null || validDate === null || employmentId === null
			? null
			: ctx.query({
					shift_definition: {
						where: { entity_id: { eq: entityId } },
						fields: ['code', 'variant'],
						limit: 10000
					},
					shift_pattern: {
						where: { entity_id: { eq: entityId } },
						fields: ['pattern', 'effective_range'],
						limit: 10000
					},
					holiday: {
						where: {
							entity_id: { eq: entityId },
							published_at: { is_null: false },
							date: { eq: validDate }
						},
						fields: ['date', 'name', 'employee_id'],
						limit: 100
					},
					leave_catalog_entry: {
						where: { employment_id: { eq: idOf('employment', employmentId) } },
						fields: ['catalog_code', 'encashment'],
						limit: 1000,
						leave_catalog_entry_day: {
							where: { incurred_on: { eq: validDate } },
							fields: ['incurred_on', 'part'],
							limit: 10
						}
					}
				})
	);

	const projected = $derived.by<{
		readonly shift: ShiftRow | null;
		readonly minutes: number | null;
		readonly holidays: readonly string[];
		readonly leave: readonly string[];
	}>(() => {
		if (stint === null || validDate === null || contextQuery?.current === undefined) {
			return { shift: null, minutes: null, holidays: [], leave: [] };
		}
		const agreed = employmentOn(
			{
				stint: jsonObject({ id: stint.id, effective_range: stint.effective_range }),
				terms: (stint.terms ?? []).map(jsonObject),
				parameters: [],
				profile: {},
				dependants: []
			},
			validDate
		).terms;
		const patternId =
			isJsonObject(agreed) && typeof agreed.shift_pattern_id === 'string'
				? agreed.shift_pattern_id
				: null;
		const pattern =
			patternId === null
				? undefined
				: contextQuery.current.shift_pattern.rows.find((row) => String(row.id) === patternId);
		const shiftId = cycleShiftId(pattern, validDate);
		const shift =
			shiftId === null
				? null
				: (contextQuery.current.shift_definition.rows.find((row) => String(row.id) === shiftId) ??
					null);
		const holidays = contextQuery.current.holiday.rows
			.filter((row) => row.employee_id == null || String(row.employee_id) === employeeId)
			.map((row) => row.name);
		const leave = contextQuery.current.leave_catalog_entry.rows
			.filter((row) => row.encashment !== true && (row.leave_catalog_entry_day?.length ?? 0) > 0)
			.map((row) => {
				const parts = [
					...new Set((row.leave_catalog_entry_day ?? []).map((slot) => String(slot.part)))
				];
				return parts.length < 2 ? `${row.catalog_code} ${parts.join('/')}` : row.catalog_code;
			});
		return { shift, minutes: shiftMinutes(shift ?? undefined), holidays, leave };
	});

	const recordFindings = $derived.by<readonly string[]>(() => {
		const raw = record?.findings;
		if (!Array.isArray(raw)) return [];
		return raw.flatMap((item) => {
			if (!isJsonObject(item)) return [];
			if (typeof item.message === 'string' && item.message !== '') return [item.message];
			if (typeof item.code === 'string' && item.code !== '') return [item.code];
			return [];
		});
	});

	const instantAt = (date: string, hhmm: string, zone: string): string =>
		Result.getOrElse(
			Result.try(() =>
				DateTime.formatIso(
					DateTime.makeZonedUnsafe(`${date}T${hhmm}:00`, {
						timeZone: zone,
						adjustForTimeZone: true
					})
				)
			),
			() => `${date}T${hhmm}:00.000Z`
		);

	const nextDayOf = (date: string): string =>
		DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(date), { days: 1 }));

	const defaultInterval = (forOvertime: boolean): EditableInterval => {
		const day = validDate ?? String(clock.today);
		const variant = projected.shift?.variant;
		if (forOvertime) {
			const startClock =
				variant?.day_type === 'WORK' && typeof variant.end_time === 'string'
					? variant.end_time
					: '18:00';
			const startDay = variant?.ends_next_day === true ? nextDayOf(day) : day;
			const start = instantAt(startDay, startClock, timeZone);
			const end = DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(start), { hours: 2 }));
			return { start, end };
		}
		if (
			variant?.day_type === 'WORK' &&
			typeof variant.start_time === 'string' &&
			typeof variant.end_time === 'string'
		) {
			const start = instantAt(day, variant.start_time, timeZone);
			const endDay = variant.ends_next_day === true ? nextDayOf(day) : day;
			const end = instantAt(endDay, variant.end_time, timeZone);
			return { start, end };
		}
		return {
			start: instantAt(day, '09:00', timeZone),
			end: instantAt(day, '18:00', timeZone)
		};
	};

	const parseIntervals = (value: Value): EditableInterval[] => {
		if (!Array.isArray(value)) return [];
		return value.flatMap((item): EditableInterval[] => {
			if (!isJsonObject(item)) return [];
			const breaks = Array.isArray(item.breaks)
				? item.breaks.flatMap((span) =>
						isJsonObject(span) && typeof span.start === 'string' && typeof span.end === 'string'
							? [{ start: span.start, end: span.end }]
							: []
					)
				: undefined;
			return [
				{
					start: typeof item.start === 'string' ? item.start : null,
					end: typeof item.end === 'string' ? item.end : null,
					...(typeof item.break_minutes === 'number' ? { break_minutes: item.break_minutes } : {}),
					...(breaks !== undefined && breaks.length > 0 ? { breaks } : {})
				}
			];
		});
	};

	const serializeIntervals = (items: readonly EditableInterval[], allowOpenEnd: boolean): Value =>
		items.map((item) => ({
			start: item.start,
			...(item.end !== null ? { end: item.end } : allowOpenEnd ? { end: null } : {}),
			...(item.break_minutes !== undefined ? { break_minutes: item.break_minutes } : {}),
			...(item.breaks !== undefined && item.breaks.length > 0 ? { breaks: item.breaks } : {})
		}));

	const intervalLabel = (item: EditableInterval): string => {
		const start = item.start === null ? '—' : clockStampOf(item.start, timeZone);
		const end =
			item.end === null ? ctx.t('roster.interval_open') : clockStampOf(item.end, timeZone);
		const mins =
			item.start !== null
				? workedMinutes([
						{
							start: item.start,
							end: item.end,
							break_minutes: item.break_minutes ?? null,
							breaks: item.breaks ?? null
						}
					])
				: null;
		const parts = [`${start} → ${end}`];
		if (mins !== null) parts.push(hoursLabel(mins));
		if (item.break_minutes != null && item.break_minutes > 0) parts.push(`${item.break_minutes}m`);
		return parts.join(' · ');
	};

	const shiftScheduleText = (shift: ShiftRow): string => {
		const variant = shift.variant;
		if (variant.day_type !== 'WORK') return variant.day_type;
		const pieces: string[] = [];
		if (variant.start_time != null && variant.end_time != null) {
			pieces.push(
				`${variant.start_time}–${variant.end_time}${variant.ends_next_day === true ? ' (+1d)' : ''}`
			);
		} else if (variant.untimed_hours != null) {
			pieces.push(`${variant.untimed_hours}h`);
		}
		const mins = shiftMinutes(shift);
		if (mins !== null && mins > 0) pieces.push(hoursLabel(mins));
		return pieces.join(' · ');
	};

	const consentSummaryOf = (value: Value): string => {
		if (!isJsonObject(value)) return ctx.t('roster.consent_none');
		const ref =
			typeof value.reference === 'string' && value.reference !== '' ? value.reference : null;
		return ref === null
			? ctx.t('roster.consent_recorded')
			: `${ctx.t('roster.consent_recorded')} · ${ref}`;
	};
</script>

{#snippet shiftEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="shift_definition"
		id={field.id}
		{...entityId === null ? {} : { where: { entity_id: { eq: entityId } } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

{#snippet intervalEditor(field: FieldEditor, forOvertime: boolean)}
	{@const items = parseIntervals(field.value)}
	{@const allowOpenEnd = !forOvertime}
	{@const commit = (next: readonly EditableInterval[]) =>
		field.on_change(next.length === 0 ? [] : serializeIntervals(next, allowOpenEnd))}
	<Stack gap="sm">
		{#if items.length === 0}
			<p class="text-sm text-muted-foreground">{ctx.t('roster.intervals_none')}</p>
		{:else}
			{#each items as item, index (index)}
				<Surface tone="subtle" padding="sm" radius="control">
					<div class="grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end">
						<Stack gap="xs">
							<Label for={`${field.id}-${index}-start`}>{ctx.t('roster.interval_start')}</Label>
							<TimeInput
								{ctx}
								of="instant"
								precision="minute"
								id={`${field.id}-${index}-start`}
								value={item.start}
								disabled={field.disabled}
								on_change={(start: string | null) =>
									commit(items.map((row, i) => (i === index ? { ...row, start } : row)))}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${field.id}-${index}-end`}>{ctx.t('roster.interval_end')}</Label>
							<TimeInput
								{ctx}
								of="instant"
								precision="minute"
								id={`${field.id}-${index}-end`}
								value={item.end}
								disabled={field.disabled}
								on_change={(end: string | null) =>
									commit(items.map((row, i) => (i === index ? { ...row, end } : row)))}
							/>
						</Stack>
						<Stack gap="xs">
							<Label for={`${field.id}-${index}-break`}>{ctx.t('roster.interval_break')}</Label>
							<Input
								id={`${field.id}-${index}-break`}
								type="number"
								min="0"
								step="1"
								value={item.break_minutes === undefined ? '' : String(item.break_minutes)}
								disabled={field.disabled}
								oninput={(event) => {
									const raw = event.currentTarget.value.trim();
									const parsed = raw === '' ? undefined : Number(raw);
									const break_minutes =
										parsed !== undefined && Number.isFinite(parsed) && parsed >= 0
											? parsed
											: undefined;
									commit(
										items.map((row, i) => {
											if (i !== index) return row;
											const { break_minutes: _dropped, ...rest } = row;
											return break_minutes === undefined ? rest : { ...rest, break_minutes };
										})
									);
								}}
							/>
						</Stack>
						<Button
							size="icon"
							variant="outline"
							aria-label={ctx.t('roster.interval_remove')}
							hint={ctx.t('roster.interval_remove')}
							disabled={field.disabled}
							onclick={() => commit(items.filter((_, i) => i !== index))}
						>
							<Icon name="lucide:x" class="size-4" />
						</Button>
					</div>
				</Surface>
			{/each}
		{/if}
		<div>
			<Button
				variant="outline"
				disabled={field.disabled}
				onclick={() => commit([...items, defaultInterval(forOvertime)])}
			>
				<Icon name="lucide:plus" class="size-4" />
				{ctx.t('roster.interval_add')}
			</Button>
		</div>
	</Stack>
{/snippet}

{#snippet intervalView(field: FieldView)}
	{@const items = parseIntervals(field.value)}
	{#if items.length === 0}
		<span class="text-sm text-muted-foreground">{ctx.t('roster.intervals_none')}</span>
	{:else}
		<Stack gap="xs">
			{#each items as item, index (index)}
				<span class="text-sm tabular-nums">{intervalLabel(item)}</span>
			{/each}
		</Stack>
	{/if}
{/snippet}

{#snippet plannedOvertimeEditor(field: FieldEditor)}
	{@render intervalEditor(field, true)}
{/snippet}

{#snippet actualWorkedEditor(field: FieldEditor)}
	{@render intervalEditor(field, false)}
{/snippet}

<RecordShell
	{ctx}
	of="roster_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Form
		{ctx}
		of="roster_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		confirm={paid.confirm(() => record?.payroll_run_id != null, ['work_date'])}
	>
		{#snippet children(form)}
			{@const consentVal = form.get('consent')}
			{@const hasConsent = isJsonObject(consentVal)}
			<Stack gap="lg">
				{#if record !== null && recordFindings.length > 0}
					<Alert.Root variant="warning" size="sm">
						<Icon name="lucide:triangle-alert" class="size-4" />
						<Alert.Title>{ctx.t('roster.findings')}</Alert.Title>
						<Alert.Description>
							<ul class="list-disc pl-4">
								{#each recordFindings as message (message)}
									<li>{message}</li>
								{/each}
							</ul>
						</Alert.Description>
					</Alert.Root>
				{/if}

				{#if employmentId !== null && validDate !== null}
					<Surface tone="subtle" padding="sm" radius="control">
						<Stack gap="xs">
							<span class="text-micro font-medium text-muted-foreground">
								{ctx.t('roster.projected_schedule')}
							</span>
							<Cluster gap="sm" align="center">
								{#if projected.shift !== null}
									<Badge variant="outline">{projected.shift.code}</Badge>
									<span class="text-sm tabular-nums text-foreground">
										{shiftScheduleText(projected.shift)}
									</span>
								{:else}
									<span class="text-sm text-muted-foreground">
										{ctx.t('roster.projected_none')}
									</span>
								{/if}
								{#each projected.holidays as holiday (holiday)}
									<Badge variant="warning">{ctx.t('roster.public_holiday')}: {holiday}</Badge>
								{/each}
								{#each projected.leave as leaveItem (leaveItem)}
									<Badge variant="info">{ctx.t('roster.leave')}: {leaveItem}</Badge>
								{/each}
							</Cluster>
						</Stack>
					</Surface>
				{/if}

				<Grid minimum="card">
					<Field {ctx} name="employment_id" disabled={lockedEmployment} />
					<Field {ctx} name="work_date" disabled={lockedDate} />
					<Field {ctx} name="shift_definition_id" editor={shiftEditor} />
					<Field {ctx} name="overtime_as_time_off" />
				</Grid>

				<Field
					{ctx}
					name="planned_overtime_intervals"
					editor={plannedOvertimeEditor}
					view={intervalView}
				/>
				<Field
					{ctx}
					name="actual_worked_intervals"
					editor={actualWorkedEditor}
					view={intervalView}
				/>

				<Section
					name="roster_consent"
					title={ctx.t('roster.consent_section')}
					icon="lucide:file-check"
					default_open={hasConsent}
					summary={consentSummaryOf(consentVal)}
				>
					<Field {ctx} name="consent" />
				</Section>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
