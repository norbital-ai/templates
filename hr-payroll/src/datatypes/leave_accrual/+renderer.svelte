<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { leaveAccrualSchema } from './+definition.js';
	import type { LeaveSettlement } from '../leave_settlement/+definition.js';
	import type { RendererProps, Value } from './$types.js';
	const { t } = useI18n<TenantI18nKeys>();

	type AccrualKind = Value['kind'];
	type Settlement = LeaveSettlement['settlement'];

	const KIND_OPTIONS: { value: AccrualKind; label: string; description: string }[] = [
		{ value: 'MONTHLY', label: 'Monthly', description: 'Pro-rata each completed month' },
		{ value: 'UPFRONT', label: 'Upfront', description: 'Whole band at the leave-year start' },
		{
			value: 'UNLIMITED',
			label: 'Unmetered',
			description: 'Yearly account required; no balance ceiling'
		}
	];

	const SETTLEMENT_OPTIONS: { value: Settlement; label: string; description: string }[] = [
		{ value: 'FORFEIT', label: 'Lapse', description: 'Unused days lapse' },
		{ value: 'CARRY', label: 'Carry forward', description: 'Unused days move to next year' },
		{ value: 'COMMUTE', label: 'Commute to cash', description: 'Unused days paid out at year end' }
	];

	const PAY_BASIS_OPTIONS = [
		{ value: 'ORDINARY_DIV26' as const, label: 'Monthly ÷ 26' },
		{ value: 'MONTHLY_DIV30' as const, label: 'Monthly ÷ 30' },
		{ value: 'DAILY_WAGE' as const, label: 'Daily wage' }
	];

	const DEFAULT_CARRY: LeaveSettlement = {
		settlement: 'CARRY',
		limit_days: 0,
		expiry_months: 0,
		coverage: null
	};
	const DEFAULT_COMMUTE: LeaveSettlement = { settlement: 'COMMUTE', pay_basis: 'ORDINARY_DIV26' };

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(leaveAccrualSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'UNLIMITED') return 'Unmetered';
		const settlement = current.settlement;
		const tail =
			settlement.settlement === 'CARRY'
				? `carry ${settlement.limit_days ?? 'all'}d / expires ${settlement.expiry_months}m`
				: settlement.settlement === 'COMMUTE'
					? `commutes (${settlement.pay_basis})`
					: 'no carry forward';
		return `${current.kind === 'MONTHLY' ? 'Monthly' : 'Upfront'} · ${tail}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(kind: AccrualKind): Value {
		switch (kind) {
			case 'MONTHLY':
				return { kind: 'MONTHLY', settlement: { settlement: 'FORFEIT' } };
			case 'UPFRONT':
				return { kind: 'UPFRONT', settlement: { settlement: 'FORFEIT' } };
			case 'UNLIMITED':
				return { kind: 'UNLIMITED' };
		}
	}

	function selectSettlement(next: Settlement | null): void {
		if (current === null || current.kind === 'UNLIMITED' || next === null) return;
		if (current.settlement.settlement === next) return;
		emit({
			...current,
			settlement:
				next === 'CARRY'
					? DEFAULT_CARRY
					: next === 'COMMUTE'
						? DEFAULT_COMMUTE
						: { settlement: 'FORFEIT' }
		});
	}

	/*
	 * Every variant renderer needs this same three-line guard, but it closes over this file's
	 * `current`, `emit` and `defaultFor`. Sharing it would mean a generic taking three callbacks —
	 * `controller-surfaces.md` §2 calls that a wrapper thinner than the thing it wraps. The pure
	 * coercions these renderers used to duplicate did move, to lib/ui/renderer-input.ts.
	 */
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note above.
	function selectKind(kind: AccrualKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Accrual
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.leave_accrual.select_accrual')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>

		{#if current?.kind === 'MONTHLY' || current?.kind === 'UPFRONT'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Year-end settlement
					<Combobox
						options={SETTLEMENT_OPTIONS}
						value={current.settlement.settlement}
						{disabled}
						searchable={false}
						emptyPlaceholder={t('renderer.leave_accrual.select_settlement')}
						onValueChange={selectSettlement}
					/>
				</Stack>
			</label>

			{#if current.settlement.settlement === 'CARRY'}
				{@const carry = current.settlement}
				<label class="text-sm font-medium">
					<Stack gap="xs">
						Carry limit (days, blank for whole balance)
						<Input
							type="number"
							min="0"
							step="0.5"
							value={carry.limit_days ?? ''}
							{disabled}
							oninput={(event) => {
								const raw = event.currentTarget.value.trim();
								emit({
									...current,
									settlement: {
										...carry,
										limit_days: raw === '' ? null : numberFrom(raw, 0)
									}
								});
							}}
						/>
					</Stack>
				</label>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						Expires after (months)
						<Input
							type="number"
							min="0"
							step="1"
							value={carry.expiry_months}
							{disabled}
							oninput={(event) =>
								emit({
									...current,
									settlement: {
										...carry,
										expiry_months: numberFrom(event.currentTarget.value, 0)
									}
								})}
						/>
					</Stack>
				</label>
			{:else if current.settlement.settlement === 'COMMUTE'}
				{@const commute = current.settlement}
				<label class="text-sm font-medium">
					<Stack gap="xs">
						Daily-rate basis
						<Combobox
							options={PAY_BASIS_OPTIONS}
							value={commute.pay_basis}
							{disabled}
							searchable={false}
							emptyPlaceholder={t('renderer.leave_accrual.select_pay_basis')}
							onValueChange={(basis) => {
								if (
									basis !== 'ORDINARY_DIV26' &&
									basis !== 'MONTHLY_DIV30' &&
									basis !== 'DAILY_WAGE'
								)
									return;
								emit({ ...current, settlement: { ...commute, pay_basis: basis } });
							}}
						/>
					</Stack>
				</label>
			{/if}
		{/if}
	</Grid>
{/if}
