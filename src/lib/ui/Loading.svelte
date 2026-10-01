<script lang="ts">
	/** A page body still loading: a centred spinner that fades in after a short wait, so a fast load shows nothing. */
	import { Spinner } from '@norbital-ai/ui';
	import { Cover } from '@norbital-ai/ui/layout';
	import { t } from './t.js';
</script>

<Cover center grow class="transition-opacity delay-300 duration-300 starting:opacity-0">
	<Spinner class="size-5 text-muted-foreground" label={t('component.loading')} />
</Cover>
