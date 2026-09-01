<script lang="ts">
	import { Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { settlementPolicySchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	import { decodeNumber } from '@norbital-ai/std/json';

	type FinalPeriod = Value['final_period'];
	type FinalPeriodWages = Value['final_period_wages'];
	type AbsenceProration = NonNullable<Value['absence_proration']>[number];
	type OvertimeWindow = NonNullable<Value['overtime_windows']>[number];
	type PayFrequency = AbsenceProration['pay_frequency'];
	type AbsenceBasis = AbsenceProration['basis']['by'];
	type SettlementPolicyRendererProps = RendererProps & {
		readonly row?: Record<string, unknown>;
	};
	type AbsenceRow = {
		readonly id: string;
		readonly pay_frequency: PayFrequency;
		readonly basis: AbsenceBasis;
		readonly fixed_days: number | null;
	};
	type OvertimeWindowRow = OvertimeWindow & { readonly id: string };

	const { t } = useI18n<TenantI18nKeys>();
	const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;
	const enumField = (name: string, values: readonly string[]): CollectionField => ({
		name,
		kind: 'enum',
		nullable: false,
		values
	});
	const numericField = (name: string, nullable = false): CollectionField => ({
		name,
		kind: 'numeric',
		nullable
	});
	const integerField = (name: string): CollectionField => ({
		name,
		kind: 'integer',
		nullable: false
	});
	const ABSENCE_COLUMNS = [
		{
			key: 'pay_frequency',
			label: 'Pay frequency',
			field: enumField('pay_frequency', PAY_FREQUENCIES),
			width: 170
		},
		{
			key: 'basis',
			label: 'Value unpaid days by',
			field: enumField('basis', ['CALENDAR_DAYS', 'WORKING_DAYS', 'FIXED_DAYS']),
			width: 200
		},
		{
			key: 'fixed_days',
			label: 'Fixed days',
			field: numericField('fixed_days', true),
			placeholder: 'Only for fixed-days basis',
			width: 170
		}
	] satisfies readonly MatrixColumn<AbsenceRow>[];
	const OVERTIME_WINDOW_COLUMNS = [
		{
			key: 'pay_frequency',
			label: 'Pay frequency',
			field: enumField('pay_frequency', PAY_FREQUENCIES),
			width: 170
		},
		{ key: 'start_day', label: 'From day', field: integerField('start_day'), width: 140 },
		{ key: 'end_day', label: 'To day', field: integerField('end_day'), width: 140 }
	] satisfies readonly MatrixColumn<OvertimeWindowRow>[];

	const FINAL_PERIOD_OPTIONS = $derived<
		{ value: FinalPeriod; label: string; description: string }[]
	>([
		{
			value: 'SETTLE_IN_FINAL_PERIOD',
			label: t('renderer.settlement_policy.settle_final_period'),
			description: t('renderer.settlement_policy.settle_final_period_desc')
		},
		{
			value: 'FOLLOW_ATTENDANCE_WINDOW',
			label: t('renderer.settlement_policy.follow_attendance_window'),
			description: t('renderer.settlement_policy.follow_attendance_window_desc')
		}
	]);
	const FINAL_PERIOD_WAGES_OPTIONS = $derived<
		{ value: FinalPeriodWages; label: string; description: string }[]
	>([
		{
			value: 'PRORATE_TO_EXIT',
			label: t('renderer.settlement_policy.prorate_to_exit'),
			description: t('renderer.settlement_policy.prorate_to_exit_desc')
		},
		{
			value: 'FULL_PERIOD',
			label: t('renderer.settlement_policy.full_period'),
			description: t('renderer.settlement_policy.full_period_desc')
		}
	]);

	const EMPTY: Value = {
		late_joiner_arrears: null,
		final_period: 'FOLLOW_ATTENDANCE_WINDOW',
		final_period_wages: 'PRORATE_TO_EXIT',
		extended_unpaid_leave: null,
		absence_proration: null,
		overtime_windows: null
	};

	let props: SettlementPolicyRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(settlementPolicySchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const companyId = $derived(typeof props.row?.id === 'string' ? props.row.id : null);
	const componentsQuery = $derived(
		companyId == null
			? null
			: client.db.pay_components.findMany({
					where: { company_id: { eq: companyId } },
					orderBy: { code: 'asc' },
					limit: 500
				})
	);
	const componentOptions = $derived(
		(componentsQuery?.current ?? [])
			.filter((component) => component.definition?.source === 'ENTRY')
			.map((component) => ({
				value: component.id,
				label: component.code || '—',
				search_term: `${component.code ?? ''}`
			}))
	);
	const contributionsQuery = $derived(
		client.db.statutory_contributions.findMany({
			orderBy: { code: 'asc' },
			limit: 500
		})
	);
	const contributionOptions = $derived(
		(contributionsQuery.current ?? []).map((contribution) => ({
			value: contribution.id,
			label: [contribution.code, contribution.name].filter((part) => part).join(' · ') || '—',
			search_term: `${contribution.code ?? ''} ${contribution.name ?? ''}`
		}))
	);
	const absenceRows = $derived(
		(current?.absence_proration ?? []).map((entry, index): AbsenceRow => ({
			id: `absence-${index}`,
			pay_frequency: entry.pay_frequency,
			basis: entry.basis.by,
			fixed_days: entry.basis.by === 'FIXED_DAYS' ? entry.basis.days : null
		}))
	);
	const overtimeWindowRows = $derived(
		(current?.overtime_windows ?? []).map((entry, index): OvertimeWindowRow => ({
			id: `overtime-window-${index}`,
			...entry
		}))
	);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		const parts = [
			current.late_joiner_arrears
				? t('renderer.settlement_policy.summary_late_joiners_deferred')
				: null,
			current.final_period === 'SETTLE_IN_FINAL_PERIOD'
				? t('renderer.settlement_policy.summary_final_period_settled')
				: null,
			current.final_period_wages === 'FULL_PERIOD'
				? t('renderer.settlement_policy.summary_full_period_wages')
				: null,
			current.extended_unpaid_leave
				? t('renderer.settlement_policy.summary_extended_leave', {
						days: current.extended_unpaid_leave.minimum_calendar_days
					})
				: null
		].filter((part) => part !== null);
		return parts.length === 0
			? t('renderer.settlement_policy.summary_plain_calendar')
			: parts.join(' · ');
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
	function patch(change: Partial<Value>): void {
		emit({ ...(current ?? EMPTY), ...change });
	}
	function integerFrom(raw: string, fallback: number): number {
		const next = Math.trunc(decodeNumber(raw));
		return Number.isFinite(next) ? next : fallback;
	}
	function absenceProration(rows: AbsenceRow[]): NonNullable<Value['absence_proration']> {
		return rows.map((row) => ({
			pay_frequency: row.pay_frequency,
			basis:
				row.basis === 'FIXED_DAYS'
					? { by: 'FIXED_DAYS', days: row.fixed_days ?? 1 }
					: { by: row.basis }
		}));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="lg">
		<Stack as="section" gap="sm">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Joining and leaving</h3>
				<p class="text-meta">How pay settles at the two ends of an employment.</p>
			</Stack>
			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.settlement_policy.late_joiners_paid_on')}
						<Combobox
							ariaLabel={t('renderer.settlement_policy.aria_late_joiner_component')}
							options={componentOptions}
							value={current?.late_joiner_arrears?.defer_to_component_id ?? null}
							disabled={disabled || companyId == null}
							searchPlaceholder={t('component.search_pay_components')}
							emptyPlaceholder={t('renderer.settlement_policy.nothing_deferred')}
							clientConfig={{
								isLoading: componentsQuery?.loading ?? false,
								error: componentsQuery?.error?.message ?? null
							}}
							onValueChange={(value) =>
								patch({
									late_joiner_arrears:
										typeof value === 'string' && value !== ''
											? { defer_to_component_id: value }
											: null
								})}
						/>
						<span class="text-xs font-normal text-muted-foreground">
							{t('renderer.settlement_policy.hint_arrears_component')}
						</span>
					</Stack>
				</label>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.settlement_policy.final_period')}
						<Combobox
							ariaLabel={t('renderer.settlement_policy.final_period')}
							options={FINAL_PERIOD_OPTIONS}
							value={current?.final_period ?? EMPTY.final_period}
							{disabled}
							searchable={false}
							onValueChange={(value) =>
								patch({
									final_period: (value as FinalPeriod | null) ?? 'FOLLOW_ATTENDANCE_WINDOW'
								})}
						/>
					</Stack>
				</label>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.settlement_policy.final_period_wages')}
						<Combobox
							ariaLabel={t('renderer.settlement_policy.final_period_wages')}
							options={FINAL_PERIOD_WAGES_OPTIONS}
							value={current?.final_period_wages ?? EMPTY.final_period_wages}
							{disabled}
							searchable={false}
							onValueChange={(value) =>
								patch({
									final_period_wages: (value as FinalPeriodWages | null) ?? 'PRORATE_TO_EXIT'
								})}
						/>
					</Stack>
				</label>
			</Grid>
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Extended unpaid leave</h3>
				<p class="text-meta">
					Set the minimum to 0 when long absences follow the normal pay window.
				</p>
			</Stack>
			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.settlement_policy.extended_leave_min_days')}
						<Input
							type="number"
							min="0"
							step="1"
							value={current?.extended_unpaid_leave?.minimum_calendar_days ?? 0}
							{disabled}
							oninput={(event) => {
								const days = integerFrom(event.currentTarget.value, 0);
								patch({
									extended_unpaid_leave:
										days <= 0
											? null
											: {
													minimum_calendar_days: days,
													bridged_gap_days: current?.extended_unpaid_leave?.bridged_gap_days ?? 0,
													population_contribution_id:
														current?.extended_unpaid_leave?.population_contribution_id ?? null
												}
								});
							}}
						/>
					</Stack>
				</label>
				{#if current?.extended_unpaid_leave}
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('renderer.settlement_policy.bridged_gap_days')}
							<Input
								type="number"
								min="0"
								step="1"
								value={current.extended_unpaid_leave.bridged_gap_days}
								{disabled}
								oninput={(event) =>
									patch({
										extended_unpaid_leave: {
											...current.extended_unpaid_leave!,
											bridged_gap_days: integerFrom(event.currentTarget.value, 0)
										}
									})}
							/>
						</Stack>
					</label>
					<label class="text-sm font-medium">
						<Stack gap="xs">
							{t('renderer.settlement_policy.applies_to_employments')}
							<Combobox
								ariaLabel={t('renderer.settlement_policy.aria_extended_population')}
								options={contributionOptions}
								value={current.extended_unpaid_leave.population_contribution_id}
								{disabled}
								searchPlaceholder={t('renderer.settlement_policy.search_statutory_schemes')}
								emptyPlaceholder={t('renderer.settlement_policy.every_employment')}
								clientConfig={{
									isLoading: contributionsQuery.loading,
									error: contributionsQuery.error?.message ?? null
								}}
								onValueChange={(value) =>
									patch({
										extended_unpaid_leave: {
											...current.extended_unpaid_leave!,
											population_contribution_id:
												typeof value === 'string' && value !== '' ? value : null
										}
									})}
							/>
						</Stack>
					</label>
				{/if}
			</Grid>
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Unpaid absence valuation</h3>
				<p class="text-meta">
					Only add a row when a pay frequency differs from the jurisdiction default.
				</p>
			</Stack>
			<MatrixRenderer
				rows={absenceRows}
				columns={ABSENCE_COLUMNS}
				{disabled}
				emptyMessage="The jurisdiction proration rule applies to every pay frequency"
				addRowLabel="Add pay-frequency override"
				createRow={(): AbsenceRow => ({
					id: crypto.randomUUID(),
					pay_frequency: 'MONTHLY',
					basis: 'WORKING_DAYS',
					fixed_days: null
				})}
				bounded={false}
				onChange={(rows) =>
					patch({ absence_proration: rows.length === 0 ? null : absenceProration(rows) })}
			/>
		</Stack>

		<Stack as="section" gap="sm" class="border-t border-border pt-5">
			<Stack gap="xs">
				<h3 class="text-sm font-semibold">Overtime attendance windows</h3>
				<p class="text-meta">
					Only add a row when overtime uses a narrower window than ordinary pay.
				</p>
			</Stack>
			<MatrixRenderer
				rows={overtimeWindowRows}
				columns={OVERTIME_WINDOW_COLUMNS}
				{disabled}
				emptyMessage="Overtime follows the ordinary attendance window"
				addRowLabel="Add overtime window"
				createRow={(): OvertimeWindowRow => ({
					id: crypto.randomUUID(),
					pay_frequency: 'SEMI_MONTHLY',
					start_day: 1,
					end_day: 15
				})}
				bounded={false}
				onChange={(rows) =>
					patch({
						overtime_windows: rows.length === 0 ? null : rows.map(({ id: _, ...window }) => window)
					})}
			/>
		</Stack>
	</Stack>
{/if}
