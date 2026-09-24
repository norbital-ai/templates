<script lang="ts">
	/**
	 * End an active employment: last day of work, why, and a note.
	 *
	 * Departure closes the contract's range on the last day. The `leave_encashment_on_exit`
	 * automation then raises the leaver's unused encashable balance as a held `ENCASHMENT` for the
	 * HR Manager to approve or reject, so this form settles no leave itself.
	 */
	import { Effect } from 'effect';
	import { client } from '../../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Button } from '@norbital-ai/ui/button';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { dateKey } from '../../iso-day.js';
	import { endOfDayInstant, todayKey } from '../calendar.js';
	import FormSection from '../form-section.svelte';
	import ExitFactsRenderer from './exit-facts-renderer.svelte';

	type ExitReason = NonNullable<WorkspaceRow<'employments'>['exit_reason']>;
	const EXIT_REASONS: readonly ExitReason[] = [
		'RESIGNATION',
		'DISMISSAL',
		'REDUNDANCY',
		'RETRENCHMENT',
		'UNILATERAL',
		'RETIREMENT',
		'END_OF_CONTRACT',
		'MUTUAL',
		'DEATH'
	];

	let {
		employment,
		onclose
	}: {
		employment: {
			readonly id: string;
			readonly range_start: string;
			readonly company_id: string;
			readonly employee_number: unknown;
		};
		onclose: () => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const startDay = $derived(dateKey(employment.range_start));

	let lastDay = $state(todayKey());
	let exitReason = $state<ExitReason | ''>('');
	let note = $state('');
	let exitFacts = $state<NonNullable<WorkspaceRow<'employments'>['exit_facts']>>({});
	let stepError = $state<string | null>(null);
	let submitting = $state(false);

	const lastDayValid = $derived(lastDay !== '' && lastDay >= startDay);
</script>

<Stack gap="lg">
	<FormSection first title={t('offboarding.step_last_day')} hint={t('offboarding.last_day_hint')}>
		<Stack gap="sm">
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('offboarding.last_day')}<Input
						type="date"
						value={lastDay}
						min={startDay}
						oninput={(event) => {
							lastDay = event.currentTarget.value;
						}}
					/></Stack
				></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('component.exit_reason')}<select
						class="border-input bg-background h-8 rounded-md border px-3 text-sm"
						value={exitReason}
						onchange={(event) => {
							exitReason = event.currentTarget.value as ExitReason | '';
						}}
					>
						<option value=""></option>
						{#each EXIT_REASONS as reason (reason)}<option value={reason}>{reason}</option>{/each}
					</select></Stack
				></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('offboarding.note')}<Input
						value={note}
						oninput={(event) => {
							note = event.currentTarget.value;
						}}
					/></Stack
				></label
			>
			<p class="text-meta">{t('offboarding.leave_hint')}</p>
			<FormSection title={t('component.exit_facts')} hint={t('component.exit_facts_hint')}>
				<ExitFactsRenderer
					mode="edit"
					field={{ name: 'exit_facts', type: 'entity_facts' }}
					value={exitFacts}
					disabled={submitting}
					companyId={employment.company_id}
					lastDay={lastDay || null}
					onValueChange={(value) => {
						exitFacts = value ?? {};
					}}
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
				if (!lastDayValid) {
					stepError = t('offboarding.need_last_day', { hire: startDay });
					return;
				}
				stepError = null;
				submitting = true;
				Effect.runFork(
					submitCollectionMutation(() =>
						client.collection.employments.update(employment.id, {
							effective_range: {
								start: employment.range_start,
								end: endOfDayInstant(lastDay)
							},
							exit_reason: exitReason === '' ? null : exitReason,
							exit_facts: exitFacts,
							comments: note.trim() === '' ? null : note.trim()
						})
					).pipe(
						Effect.tap((result) =>
							Effect.sync(() => {
								toast.success(
									result.kind === 'pendingApproval'
										? t('offboarding.pending')
										: t('offboarding.submitted')
								);
								onclose();
							})
						),
						Effect.catch((cause) =>
							Effect.sync(() => {
								stepError = getErrorMessage(cause);
								submitting = false;
							})
						)
					)
				);
			}}>{t('offboarding.submit')}</Button
		>
	</Cluster>
</Stack>
