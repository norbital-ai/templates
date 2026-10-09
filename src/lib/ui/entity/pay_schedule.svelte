<script lang="ts">
	/**
	 * An entity's pay frequency history: the frequency it pays at from its start, and each switch from its effective day.
	 * Adding or withdrawing a switch writes `pay_frequency_changes`; the entity's transform refuses one that would rewrite
	 * a period a salary run paid, and its message is shown as given.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Button, Combobox, DateInput, Label, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { FrequencyChange } from '../../payroll_engine/foundation.js';
	import { t } from '../i18n/t.js';

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
	const label = (code: string) => bolt.t(`models.entity.fields.pay_frequency.${code}` as never);
	let from = $state<string | null>(null);
	let next = $state<string | null>(null);
	let saving = $state(false);
	const ordered = $derived(changes.toSorted((a, b) => a.from.localeCompare(b.from)));

	async function write(list: readonly FrequencyChange[], done: string): Promise<void> {
		saving = true;
		try {
			const outcome = await bolt.act('entity.update', {
				target: id,
				set: {
					pay_frequency_changes: list.flatMap((change) => {
						const frequency = FREQUENCIES.find((code) => code === change.frequency);
						return frequency == null ? [] : [{ from: PlainDate(change.from), frequency }];
					})
				}
			});
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(done);
				from = null;
				next = null;
			} else
				toast.error(
					outcome.kind === 'refused'
						? (outcome.message ?? t('component.error'))
						: t('component.error')
				);
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

<Stack gap="sm">
	<p class="text-sm">
		{t('pay_schedule.from_start', { frequency: label(frequency) })}
	</p>
	{#each ordered as change (change.from)}
		<Cluster gap="sm" align="center">
			<span class="text-sm tabular-nums">
				{t('pay_schedule.switch', { day: change.from, frequency: label(change.frequency) })}
			</span>
			<Button
				size="sm"
				variant="ghost"
				disabled={saving}
				onclick={() =>
					void write(
						ordered.filter((held) => held.from !== change.from),
						t('pay_schedule.withdrawn')
					)}>{t('pay_schedule.withdraw')}</Button
			>
		</Cluster>
	{/each}
	<Cluster gap="sm" align="end">
		<Stack gap="xs">
			<Label for="pay-switch-from">{t('pay_schedule.effective')}</Label>
			<DateInput
				id="pay-switch-from"
				of="date"
				value={from}
				onChange={(value) => (from = value)}
				disabled={saving}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="pay-switch-frequency">{t('pay_schedule.frequency')}</Label>
			<Combobox
				id="pay-switch-frequency"
				options={FREQUENCIES.map((code) => ({ value: code, label: label(code) }))}
				value={next}
				disabled={saving}
				onChange={(value) => (next = value)}
			/>
		</Stack>
		<Button
			size="sm"
			disabled={saving || from == null || from === '' || next == null}
			onclick={() =>
				void write(
					[...ordered, { from: String(from), frequency: String(next) }],
					t('pay_schedule.added')
				)}>{t('pay_schedule.add')}</Button
		>
	</Cluster>
</Stack>
