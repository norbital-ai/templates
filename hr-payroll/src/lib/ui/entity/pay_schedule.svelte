<script lang="ts">
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	/**
	 * An entity's pay frequency history: the frequency it pays at from its start, and each switch from its effective day.
	 * Adding or withdrawing a switch writes `pay_frequency_changes`; the entity's transform refuses one that would rewrite
	 * a period a salary run paid, and its message is shown as given.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Button, Combobox, TimeInput, Label, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { FrequencyChange } from '../../payroll_engine/foundation.js';
	let {
		id,
		frequency,
		changes
	}: {
		id: Id<'entity'>;
		frequency: string;
		changes: readonly FrequencyChange[];
	} = $props();
	const FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS'] as const;
	const FREQUENCY_LABELS = {
		MONTHLY: 'models.entity.fields.pay_frequency.MONTHLY',
		SEMI_MONTHLY: 'models.entity.fields.pay_frequency.SEMI_MONTHLY',
		TEN_DAY: 'models.entity.fields.pay_frequency.TEN_DAY',
		INTEGER_MONTHS: 'models.entity.fields.pay_frequency.INTEGER_MONTHS'
	} as const;
	const label = (code: string) => {
		const frequency = FREQUENCIES.find((frequency) => frequency === code);
		return frequency == null ? code : bolt.t(FREQUENCY_LABELS[frequency]);
	};
	let from = $state<string | null>(null);
	let next = $state<string | null>(null);
	let saving = $state(false);
	const ordered = $derived(changes.toSorted((a, b) => a.from.localeCompare(b.from)));
	function write(list: readonly FrequencyChange[], done: string): void {
		saving = true;
		fork(
			Effect.gen(function* () {
				const outcome = yield* bolt.act('entity.update', {
					target: id,
					set: {
						pay_frequency_changes: list.flatMap((change) => {
							const frequency = FREQUENCIES.find((code) => code === change.frequency);
							return frequency == null ? [] : [{ from: PlainDate(change.from), frequency }];
						})
					}
				});
				{
					// past the person-wait the write runs on: its run reports the outcome
					if (outcome.kind === 'running') notifyOutcome(bolt, outcome);
					else if (outcome.kind === 'pendingApproval') toast.info(bolt.t('offboarding.pending'));
					else toast.success(done);
					from = null;
					next = null;
				}
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'));
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						saving = false;
					})
				)
			)
		);
	}
</script>

<Stack gap="sm">
	<p class="text-sm">
		{bolt.t('pay_schedule.from_start', { frequency: label(frequency) })}
	</p>
	{#each ordered as change (change.from)}
		<Cluster gap="sm" align="center">
			<span class="text-sm tabular-nums">
				{bolt.t('pay_schedule.switch', { day: change.from, frequency: label(change.frequency) })}
			</span>
			<Button
				size="sm"
				variant="ghost"
				disabled={saving}
				onclick={() =>
					void write(
						ordered.filter((held) => held.from !== change.from),
						bolt.t('pay_schedule.withdrawn')
					)}>{bolt.t('pay_schedule.withdraw')}</Button
			>
		</Cluster>
	{/each}
	<Cluster gap="sm" align="end">
		<Stack gap="xs">
			<Label for="pay-switch-from">{bolt.t('pay_schedule.effective')}</Label>
			<TimeInput
				id="pay-switch-from"
				of="date"
				value={from}
				onChange={(value: string | null) => (from = value)}
				disabled={saving}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="pay-switch-frequency">{bolt.t('pay_schedule.frequency')}</Label>
			<Combobox
				id="pay-switch-frequency"
				options={FREQUENCIES.map((code) => ({ value: code, label: label(code) }))}
				value={next}
				disabled={saving}
				onChange={(value) => (next = value)}
			/>
		</Stack>
		<Button
			disabled={saving || from == null || from === '' || next == null}
			onclick={() =>
				void write(
					[...ordered, { from: String(from), frequency: String(next) }],
					bolt.t('pay_schedule.added')
				)}>{bolt.t('pay_schedule.add')}</Button
		>
	</Cluster>
</Stack>
