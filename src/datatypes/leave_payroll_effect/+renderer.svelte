<script lang="ts">
	/**
	 * Whether taking this leave is paid, or unpaid and deducted through a pay line the leave
	 * declares for itself.
	 *
	 * There is no component picker any more, and that is the change. UNPAID used to carry a
	 * `component_id` into the pay catalogue — a foreign key the database cannot declare, because a
	 * variant is one JSONB value — so this renderer opened its own query, offered every component of
	 * the version, and printed a uuid on every row of the leave-types table when nobody chose one.
	 * The leave row *is* the pay line now: its code names the line, an unpaid day is an ABSENCE, and
	 * what the operator states here is the rest of what any pay line needs — how each scheme charges
	 * it, where it sits in the reduction order, and who it covers.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import ContributionTreatments from '../contribution_treatments/+renderer.svelte';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { leavePayrollEffectSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type EffectKind = Value['kind'];
	type Deduction = Extract<Value, { kind: 'UNPAID' }>['deduction'];

	const KIND_OPTIONS = $derived<{ value: EffectKind; label: string; description: string }[]>([
		{
			value: 'PAID',
			label: t('component.paid'),
			description: t('renderer.leave_payroll_effect.kind_paid_desc')
		},
		{
			value: 'UNPAID',
			label: t('component.unpaid'),
			description: t('renderer.leave_payroll_effect.kind_unpaid_desc')
		}
	]);

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(leavePayrollEffectSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(
		current === null ? '—' : current.kind === 'PAID' ? t('component.paid') : t('component.unpaid')
	);

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	/**
	 * A deduction nobody has described yet: no scheme decided, first in the reduction order,
	 * everyone covered. An empty treatment map is not an exemption — the run refuses at ACCUMULATE
	 * naming the scheme — so this default states nothing rather than guessing.
	 */
	function defaultFor(kind: EffectKind): Value {
		switch (kind) {
			case 'PAID':
				return { kind: 'PAID' };
			case 'UNPAID':
				return {
					kind: 'UNPAID',
					deduction: { contribution_treatments: {}, sequence: 0, eligibility: '' }
				};
		}
	}

	function emitDeduction(deduction: Deduction): void {
		emit({ kind: 'UNPAID', deduction });
	}

	/*
	 * Every variant renderer needs this same three-line guard, but it closes over this file's
	 * `current`, `emit` and `defaultFor`. Sharing it would mean a generic taking three callbacks —
	 * `controller-surfaces.md` §2 calls that a wrapper thinner than the thing it wraps. The pure
	 * coercions these renderers used to duplicate did move, to lib/ui/renderer-input.ts.
	 */
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note above.
	function selectKind(kind: EffectKind | null): void {
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
				{t('renderer.leave_payroll_effect.payroll_effect')}
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.leave_payroll_effect.select_effect')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current?.kind === 'UNPAID'}
			{@const deduction = current.deduction}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.applied_at')}
					<Input
						type="number"
						step="1"
						value={deduction.sequence}
						{disabled}
						oninput={(event) =>
							emitDeduction({
								...deduction,
								sequence: Math.trunc(numberFrom(event.currentTarget.value, 0))
							})}
					/>
				</Stack>
			</label>
			<Column span="all">
				<Stack gap="xs" class="text-sm font-medium">
					<span>{t('component.who_receives')}</span>
					<Input
						value={deduction.eligibility}
						placeholder={t('component.eligibility_placeholder')}
						{disabled}
						oninput={(event) =>
							emitDeduction({ ...deduction, eligibility: event.currentTarget.value })}
					/>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="xs" class="text-sm font-medium">
					<span>{t('renderer.leave_payroll_effect.deducted_on')}</span>
					<ContributionTreatments
						mode="edit"
						field={{ name: 'contribution_treatments', type: 'contribution_treatments' }}
						value={deduction.contribution_treatments}
						{disabled}
						onValueChange={(treatments) =>
							emitDeduction({ ...deduction, contribution_treatments: treatments ?? {} })}
					/>
				</Stack>
			</Column>
		{/if}
	</Grid>
{/if}
