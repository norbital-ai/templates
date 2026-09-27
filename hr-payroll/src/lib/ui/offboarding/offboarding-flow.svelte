<script lang="ts">
	/**
	 * End an active employment: last day of work, why, and a note.
	 *
	 * Departure closes the contract's range on the last day. The `leave_encashment_on_exit`
	 * automation then raises the leaver's unused encashable balance as a held `ENCASHMENT` for the
	 * HR Manager to approve or reject, so this form settles no leave itself.
	 */
	import Labelled from '../Labelled.svelte';
	import { bolt } from '$bolt';
	import { t } from '../t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Button, Combobox, DateInput, Input } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { todayKey } from '../calendar.js';
	import FormSection from '../form-section.svelte';
	import ExitFactsRenderer from './exit-facts-renderer.svelte';

	const EXIT_REASONS = [
		'RESIGNATION',
		'DISMISSAL',
		'REDUNDANCY',
		'RETRENCHMENT',
		'UNILATERAL',
		'RETIREMENT',
		'END_OF_CONTRACT',
		'MUTUAL',
		'DEATH'
	] as const;
	type ExitReason = (typeof EXIT_REASONS)[number];

	let {
		employment,
		onclose
	}: {
		employment: {
			readonly id: Id<'employments'>;
			readonly range_start: PlainDate;
			readonly company_id: Id<'companies'>;
			readonly employee_number: unknown;
		};
		onclose: () => void;
	} = $props();
	const startDay = $derived(employment.range_start);

	let lastDay = $state<string | null>(todayKey());
	let exitReason = $state<ExitReason | null>(null);
	let note = $state('');
	let exitFacts = $state<{ readonly [key: string]: string | number | boolean }>({});
	let stepError = $state<string | null>(null);
	let submitting = $state(false);

	const lastDayValid = $derived(lastDay != null && lastDay >= startDay);
</script>

<Stack gap="lg">
	<FormSection first title={t('offboarding.step_last_day')} hint={t('offboarding.last_day_hint')}>
		<Stack gap="sm">
			<Labelled label={t('offboarding.last_day')} class="text-sm font-medium">
				<DateInput value={lastDay} min={startDay} onChange={(next) => (lastDay = next)} />
			</Labelled>
			<Labelled label={t('component.exit_reason')} class="text-sm font-medium">
				<Combobox
					clearable
					options={EXIT_REASONS.map((reason) => ({ value: reason, label: reason }))}
					value={exitReason}
					onChange={(next) => (exitReason = next)}
				/>
			</Labelled>
			<Labelled label={t('offboarding.note')} class="text-sm font-medium">
				<Input
					value={note}
					oninput={(event) => {
						note = event.currentTarget.value;
					}}
				/>
			</Labelled>
			<p class="text-meta">{t('offboarding.leave_hint')}</p>
			<FormSection title={t('component.exit_facts')} hint={t('component.exit_facts_hint')}>
				<ExitFactsRenderer
					view={{
						mode: 'edit',
						name: 'exit_facts',
						value: exitFacts,
						disabled: submitting,
						onChange: (value) => {
							exitFacts = value ?? {};
						}
					}}
					companyId={employment.company_id}
					{lastDay}
				/>
			</FormSection>
		</Stack>
	</FormSection>
	{#if stepError}<p class="text-sm text-destructive" role="alert">{stepError}</p>{/if}
	<Cluster>
		<Button
			type="button"
			disabled={submitting || !lastDayValid}
			onclick={() => {
				if (lastDay == null || !lastDayValid) {
					stepError = t('offboarding.need_last_day', { hire: startDay });
					return;
				}
				stepError = null;
				submitting = true;
				void bolt
					.act('employments.update', {
						target: employment.id,
						set: {
							effective_range: { from: startDay, to: PlainDate(lastDay) },
							exit_reason: exitReason,
							exit_facts: exitFacts,
							comments: note.trim() === '' ? null : note.trim()
						}
					})
					.then((outcome) => {
						if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
							toast.success(
								outcome.kind === 'pendingApproval'
									? t('offboarding.pending')
									: t('offboarding.submitted')
							);
							onclose();
							return;
						}
						stepError = 'message' in outcome ? String(outcome.message) : t('offboarding.submit');
						submitting = false;
					});
			}}>{t('offboarding.submit')}</Button
		>
	</Cluster>
</Stack>
