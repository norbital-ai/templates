<script lang="ts">
	/**
	 * The statutory band a derived overtime adjustment was priced under, as one sentence.
	 *
	 * Read-only in every mode. This column is set by the payroll engine on exactly the rows where
	 * `pay_component_id` is NULL: overtime names no catalogue component, so the rule that paid it is
	 * the only identity it has, and a settled adjustment does not get its band re-chosen by hand.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { overtimeBandReferenceSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	let props: RendererProps = $props();
	const parsed = $derived(Schema.decodeUnknownResult(overtimeBandReferenceSchema)(props.value));
	const band = $derived(Result.isSuccess(parsed) ? parsed.success : null);

	function dayTypeLabel(dayType: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY'): string {
		switch (dayType) {
			case 'ORDINARY':
				return t('renderer.overtime_band_reference.day_ordinary');
			case 'REST_DAY':
				return t('renderer.overtime_band_reference.day_rest');
			case 'PUBLIC_HOLIDAY':
				return t('renderer.overtime_band_reference.day_public_holiday');
		}
	}

	function measureLabel(measure: 'BEYOND_NORMAL' | 'FROM_START_OF_DAY'): string {
		return measure === 'BEYOND_NORMAL'
			? t('renderer.overtime_band_reference.measure_beyond_normal')
			: t('renderer.overtime_band_reference.measure_from_start_of_day');
	}

	const summary = $derived.by((): string => {
		if (props.value == null) return t('renderer.overtime_band_reference.not_overtime');
		if (band === null) return t('renderer.overtime_band_reference.invalid');
		return [
			dayTypeLabel(band.day_type),
			measureLabel(band.measure),
			t('renderer.overtime_band_reference.from', { band_from: band.band_from }),
			band.excess ? t('renderer.overtime_band_reference.excess') : ''
		]
			.filter((part) => part !== '')
			.join(' · ');
	});
</script>

<span class="block truncate" title={summary}>{summary}</span>
