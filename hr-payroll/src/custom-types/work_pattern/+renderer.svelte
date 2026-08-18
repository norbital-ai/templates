<script lang="ts">
	import { Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { workPatternSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Patterned = Extract<Value, { type: 'PATTERNED' }>;
	type Phase = Patterned['phases'][number];
	type WorkPatternRendererProps = RendererProps & { readonly row?: Record<string, unknown> };

	let props: WorkPatternRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(workPatternSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);

	const employmentId = $derived(
		typeof props.row?.employment_id === 'string' ? props.row.employment_id : null
	);
	const employmentQuery = $derived(
		employmentId == null
			? null
			: client.db.employments.findFirst({ where: { norbital_id: { eq: employmentId } } })
	);
	const companyId = $derived(employmentQuery?.current?.company_id ?? null);
	const codesQuery = $derived(
		companyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: {
						company_id: { eq: companyId },
						norbital_approval_id: { isNull: true }
					},
					orderBy: { code: 'asc' },
					limit: 1000
				})
	);
	const codes = $derived(codesQuery?.current ?? []);
	const codeOptions = $derived(
		codes.map((code) => ({
			value: code.norbital_id,
			label: `${code.code} · ${code.name}`,
			search_term: `${code.code} ${code.name}`
		}))
	);
	const typeOptions: Array<{
		value: 'PATTERNED' | 'ROSTERED';
		label: string;
		description: string;
	}> = [
		{
			value: 'PATTERNED',
			label: 'Generated from a pattern',
			description: 'The system can project every expected day'
		},
		{
			value: 'ROSTERED',
			label: 'Assigned in each roster',
			description: 'Assignments cannot be predicted reliably'
		}
	];

	const expectationOptions: Array<{
		value: 'AS_ASSIGNED' | 'GUARANTEED_SCHEDULE';
		label: string;
		description: string;
	}> = [
		{
			value: 'AS_ASSIGNED',
			label: 'As assigned',
			description: 'No guaranteed minimum assignment'
		},
		{
			value: 'GUARANTEED_SCHEDULE',
			label: 'Guaranteed schedule',
			description: 'The roster must satisfy a contractual amount'
		}
	];

	const periodOptions: Array<{ value: 'WEEK' | 'MONTH'; label: string }> = [
		{ value: 'WEEK', label: 'Week' },
		{ value: 'MONTH', label: 'Month' }
	];

	const durationOptions: Array<{ value: 'CONTINUOUS' | 'CALENDAR_MONTHS'; label: string }> = [
		{ value: 'CONTINUOUS', label: 'Continuous' },
		{ value: 'CALENDAR_MONTHS', label: 'Calendar months' }
	];

	const summary = $derived.by(() => {
		if (current == null) return '—';
		if (current.type === 'ROSTERED') {
			if (current.expectation.kind === 'AS_ASSIGNED') {
				return current.expectation.maximum_paid_minutes == null
					? 'Roster-assigned · as assigned'
					: `Roster-assigned · max ${current.expectation.maximum_paid_minutes / 60}h/${current.expectation.period.toLowerCase()}`;
			}
			return `Roster-assigned · ${current.expectation.required_work_days}d · ${current.expectation.required_paid_minutes / 60}h/${current.expectation.period.toLowerCase()}`;
		}
		return `${current.phases.length} phase${current.phases.length === 1 ? '' : 's'} · starts ${current.anchor_date}`;
	});

	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}

	function defaultPhase(): Phase {
		return {
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [{ roster_code_id: codeOptions[0]?.value ?? crypto.randomUUID() }]
		};
	}

	function selectType(type: 'PATTERNED' | 'ROSTERED' | null): void {
		if (type === 'PATTERNED') {
			emit({ type, anchor_date: new Date().toISOString().slice(0, 10), phases: [defaultPhase()] });
			return;
		}
		if (type === 'ROSTERED') {
			emit({
				type,
				expectation: { kind: 'AS_ASSIGNED', period: 'WEEK', maximum_paid_minutes: null }
			});
		}
	}

	function updatePhase(pattern: Patterned, index: number, phase: Phase): void {
		emit({
			...pattern,
			phases: pattern.phases.map((candidate: Phase, at: number) =>
				at === index ? phase : candidate
			)
		});
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="md" class="rounded-md border bg-muted/20 p-4">
		<label class="grid gap-1.5 text-sm font-medium">
			How is work planned?
			<Combobox
				ariaLabel="Work planning method"
				options={typeOptions}
				value={current?.type ?? null}
				{disabled}
				searchable={false}
				onValueChange={selectType}
			/>
		</label>

		{#if current?.type === 'PATTERNED'}
			<label class="grid gap-1.5 text-sm font-medium">
				Pattern begins
				<Input
					type="date"
					value={current.anchor_date}
					{disabled}
					oninput={(event) => emit({ ...current, anchor_date: event.currentTarget.value })}
				/>
			</label>

			{#each current.phases as phase, phaseIndex (phaseIndex)}
				<Stack gap="sm" class="rounded-md border bg-background p-3">
					<Cluster justify="between" align="center">
						<p class="text-sm font-semibold">Phase {phaseIndex + 1}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={disabled || current.phases.length === 1}
							onclick={() =>
								emit({
									...current,
									phases: current.phases.filter((_candidate, at) => at !== phaseIndex)
								})}
						>
							Remove phase
						</Button>
					</Cluster>
					<Grid gap="sm" minimum="compact">
						<label class="grid gap-1.5 text-sm font-medium">
							Duration
							<Combobox
								ariaLabel={`Phase ${phaseIndex + 1} duration`}
								options={durationOptions}
								value={phase.duration.kind}
								{disabled}
								searchable={false}
								onValueChange={(value) => {
									if (value === 'CONTINUOUS')
										updatePhase(current, phaseIndex, {
											...phase,
											duration: { kind: 'CONTINUOUS' }
										});
									if (value === 'CALENDAR_MONTHS')
										updatePhase(current, phaseIndex, {
											...phase,
											duration: { kind: 'CALENDAR_MONTHS', months: 3 }
										});
								}}
							/>
						</label>
						{#if phase.duration.kind === 'CALENDAR_MONTHS'}
							<label class="grid gap-1.5 text-sm font-medium">
								Months
								<Input
									type="number"
									min="1"
									step="1"
									value={phase.duration.months}
									{disabled}
									oninput={(event) =>
										updatePhase(current, phaseIndex, {
											...phase,
											duration: {
												kind: 'CALENDAR_MONTHS',
												months: numberFrom(event.currentTarget.value, 1)
											}
										})}
								/>
							</label>
						{/if}
					</Grid>

					<Stack gap="xs">
						<p class="text-sm font-medium">Repeating days</p>
						{#each phase.day_cycle as day, dayIndex (dayIndex)}
							<Inline gap="sm" align="center">
								<span class="w-14 text-xs font-medium text-muted-foreground">
									Day {dayIndex + 1}
								</span>
								<Combobox
									ariaLabel={`Phase ${phaseIndex + 1} day ${dayIndex + 1}`}
									options={codeOptions}
									value={day.roster_code_id}
									{disabled}
									searchPlaceholder="Search roster codes"
									onValueChange={(value) => {
										if (typeof value !== 'string') return;
										updatePhase(current, phaseIndex, {
											...phase,
											day_cycle: phase.day_cycle.map((candidate, at) =>
												at === dayIndex ? { roster_code_id: value } : candidate
											)
										});
									}}
								/>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={disabled || phase.day_cycle.length === 1}
									onclick={() =>
										updatePhase(current, phaseIndex, {
											...phase,
											day_cycle: phase.day_cycle.filter((_candidate, at) => at !== dayIndex)
										})}
								>
									Remove
								</Button>
							</Inline>
						{/each}
						<Button
							type="button"
							variant="outline"
							disabled={disabled || codeOptions.length === 0}
							onclick={() =>
								updatePhase(current, phaseIndex, {
									...phase,
									day_cycle: [...phase.day_cycle, { roster_code_id: codeOptions[0]!.value }]
								})}
						>
							Add cycle day
						</Button>
					</Stack>
				</Stack>
			{/each}
			<Button
				type="button"
				variant="outline"
				disabled={disabled || codeOptions.length === 0}
				onclick={() =>
					emit({
						...current,
						phases: [
							...current.phases.map((phase) =>
								phase.duration.kind === 'CONTINUOUS'
									? { ...phase, duration: { kind: 'CALENDAR_MONTHS' as const, months: 3 } }
									: phase
							),
							{
								duration: { kind: 'CALENDAR_MONTHS', months: 3 },
								day_cycle: [{ roster_code_id: codeOptions[0]!.value }]
							}
						]
					})}
			>
				Add phase
			</Button>
		{:else if current?.type === 'ROSTERED'}
			<label class="grid gap-1.5 text-sm font-medium">
				Assignment expectation
				<Combobox
					ariaLabel="Roster assignment expectation"
					options={expectationOptions}
					value={current.expectation.kind}
					{disabled}
					searchable={false}
					onValueChange={(value) => {
						if (value === 'AS_ASSIGNED')
							emit({
								type: 'ROSTERED',
								expectation: {
									kind: 'AS_ASSIGNED',
									period: 'WEEK',
									maximum_paid_minutes: null
								}
							});
						if (value === 'GUARANTEED_SCHEDULE')
							emit({
								type: 'ROSTERED',
								expectation: {
									kind: 'GUARANTEED_SCHEDULE',
									period: 'WEEK',
									required_work_days: 5,
									required_paid_minutes: 2400
								}
							});
					}}
				/>
			</label>
			<Grid gap="sm" minimum="compact">
				<label class="grid gap-1.5 text-sm font-medium">
					Reference period
					<Combobox
						ariaLabel="Workload reference period"
						options={periodOptions}
						value={current.expectation.period}
						{disabled}
						searchable={false}
						onValueChange={(value) => {
							if (value === 'WEEK' || value === 'MONTH')
								emit({
									...current,
									expectation: { ...current.expectation, period: value }
								});
						}}
					/>
				</label>
				{#if current.expectation.kind === 'GUARANTEED_SCHEDULE'}
					<label class="grid gap-1.5 text-sm font-medium">
						Required workdays
						<Input
							type="number"
							min="0.5"
							step="0.5"
							value={current.expectation.required_work_days}
							{disabled}
							oninput={(event) =>
								emit({
									...current,
									expectation: {
										...current.expectation,
										required_work_days: numberFrom(event.currentTarget.value, 1)
									}
								})}
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						Required paid hours
						<Input
							type="number"
							min="0.5"
							step="0.5"
							value={current.expectation.required_paid_minutes / 60}
							{disabled}
							oninput={(event) =>
								emit({
									...current,
									expectation: {
										...current.expectation,
										required_paid_minutes: Math.round(numberFrom(event.currentTarget.value, 1) * 60)
									}
								})}
						/>
					</label>
				{:else}
					<label class="grid gap-1.5 text-sm font-medium">
						Maximum paid hours (optional)
						<Input
							type="number"
							min="0.5"
							step="0.5"
							value={(current.expectation.maximum_paid_minutes ?? 0) / 60}
							{disabled}
							oninput={(event) => {
								const hours = numberFrom(event.currentTarget.value, 0);
								emit({
									...current,
									expectation: {
										...current.expectation,
										maximum_paid_minutes: hours > 0 ? Math.round(hours * 60) : null
									}
								});
							}}
						/>
					</label>
				{/if}
			</Grid>
		{/if}

		<p class="text-xs text-muted-foreground">
			{summary}{codesQuery?.loading ? ' · Loading roster codes…' : ''}
		</p>
	</Stack>
{/if}
