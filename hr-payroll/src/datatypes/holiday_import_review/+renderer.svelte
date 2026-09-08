<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { holidayImportReviewSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';
	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const parsed = $derived(Schema.decodeUnknownResult(holidayImportReviewSchema)(props.value));
</script>

{#if Result.isSuccess(parsed)}
	<span
		>{t('holiday_import.pending')}: {parsed.success.events.filter((event) => event.review_required)
			.length}</span
	>
{:else}
	<span>—</span>
{/if}
