<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import {
		activeCompany as activeCompanyOf,
		companiesKnown as companiesKnownOf
	} from './company-scope.svelte.js';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';

	const { t } = useI18n<TenantI18nKeys>();
	const company = $derived(activeCompanyOf());
	const known = $derived(companiesKnownOf());
</script>

{#if known && company !== null}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground"
		title={t('app.hr_controller.scoped_switch_hint')}
		data-company-scope-banner
	>
		<span class="text-muted-foreground">{t('app.hr_controller.scoped_to')}</span>
		{company.name}
	</span>
{/if}
