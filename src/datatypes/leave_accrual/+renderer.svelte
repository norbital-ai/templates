<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { leaveAccrualSchema, type LeaveCarry } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	const { t } = useI18n<TenantI18nKeys>();

	type AccrualKind = Value['kind'];

	const KIND_OPTIONS: { value: AccrualKind; label: string; description: string }[] = [
		{ value: 'MONTHLY', label: 'Monthly', description: 'Pro-rata each completed month' },
		{ value: 'UPFRONT', label: 'Upfront', description: 'Whole band at the leave-year start' },
		{
			value: 'UNLIMITED',
			label: 'Unmetered',
			description: 'Yearly account required; no balance ceiling'
		}
	];

	const DEFAULT_CARRY: LeaveCarry = { limit_days: 0, expiry_months: 0 };

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(leaveAccrualSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'UNLIMITED') return 'Unmetered';
		const carry =
			current.carry === null
				? 'no carry forward'
				: `carry ${current.carry.limit_days}d / expires ${current.carry.expiry_months}m`;
		return `${current.kind === 'MONTHLY' ? 'Monthly' : 'Upfront'} · ${carry}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(kind: AccrualKind): Value {
		switch (kind) {
			case 'MONTHLY':
				return { kind: 'MONTHLY', carry: null };
			case 'UPFRONT':
				return { kind: 'UPFRONT', carry: null };
			case 'UNLIMITED':
				return { kind: 'UNLIMITED' };
		}
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
			<label class="self-end text-sm font-medium">
				<Inline gap="sm">
					<input
						type="checkbox"
						class="size-4"
						checked={current.carry !== null}
						{disabled}
						onchange={(event) =>
							emit({ ...current, carry: event.currentTarget.checked ? DEFAULT_CARRY : null })}
					/>
					Carry forward
				</Inline>
			</label>

			{#if current.carry !== null}
				{@const carry = current.carry}
				<label class="text-sm font-medium">
					<Stack gap="xs">
						Carry limit (days)
						<Input
							type="number"
							min="0"
							step="0.5"
							value={carry.limit_days}
							{disabled}
							oninput={(event) =>
								emit({
									...current,
									carry: { ...carry, limit_days: numberFrom(event.currentTarget.value, 0) }
								})}
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
									carry: { ...carry, expiry_months: numberFrom(event.currentTarget.value, 0) }
								})}
						/>
					</Stack>
				</label>
			{/if}
		{/if}
	</Grid>
{/if}
