<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import type { HolidayImportReview } from '../../datatypes/holiday_import_review/+definition.js';
	import type { HolidayObservation } from '../../datatypes/holiday_observations/+definition.js';
	import { reviewHolidayEvent } from '../holiday-import.js';

	let {
		review,
		observations,
		sealedDates = new Set<string>(),
		disabled = false,
		onchange
	}: {
		review: HolidayImportReview;
		observations: readonly HolidayObservation[];
		sealedDates?: ReadonlySet<string>;
		disabled?: boolean;
		onchange: (value: {
			import_review: HolidayImportReview;
			observations: HolidayObservation[];
		}) => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
	let error = $state<string | null>(null);

	function decide(source: string, decision: 'OBSERVE' | 'IGNORE' | 'KEEP') {
		const event = review.events.find((candidate) => candidate.source === source);
		if (!event || disabled) return;
		try {
			const selected = reviewHolidayEvent(observations, event, decision, sealedDates);
			onchange({
				observations: selected,
				import_review: {
					...review,
					events: review.events.map((candidate) =>
						candidate.source === source ? { ...candidate, review_required: false } : candidate
					)
				}
			});
			error = null;
		} catch (cause) {
			error = getErrorMessage(cause);
		}
	}
</script>

<Stack gap="md">
	<p class="text-sm text-muted-foreground">{t('holiday_import.review_hint')}</p>
	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	{#each review.events as event (event.source)}
		<Stack gap="sm" class="border-b border-border pb-3">
			<Cluster>
				<span class="text-sm font-medium">{event.name}</span>
				<span class="text-xs text-muted-foreground">
					{event.review_required ? t('holiday_import.pending') : t('holiday_import.reviewed')}
				</span>
			</Cluster>
			<p class="text-sm text-muted-foreground">
				{event.cancelled ? t('holiday_import.cancelled') : event.dates.join(', ')}
			</p>
			{#if !disabled}
				<Cluster>
					<Button
						variant="outline"
						size="sm"
						disabled={event.cancelled || !event.dates.length}
						onclick={() => decide(event.source, 'OBSERVE')}>{t('holiday_import.observe')}</Button
					>
					<Button variant="outline" size="sm" onclick={() => decide(event.source, 'IGNORE')}>
						{t('holiday_import.ignore')}</Button
					>
					<Button variant="ghost" size="sm" onclick={() => decide(event.source, 'KEEP')}>
						{t('holiday_import.keep')}</Button
					>
				</Cluster>
			{/if}
		</Stack>
	{/each}
</Stack>
