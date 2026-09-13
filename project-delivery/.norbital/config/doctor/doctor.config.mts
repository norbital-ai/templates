import { defineConfig, stringlyPack } from '@norbital-ai/doctor';

/**
 * Workspace health rules for this published template.
 *
 * This file ships with the template, so a tenant created from it in Colony is audited by the
 * same rules the template was. Add YAML extensions beside this file; they join automatically.
 */
// `norbital` / `reactivePack` live in @norbital-ai/doctor-norbital. A shipped
// template does not install that package, and the isolate audit cannot resolve
// it from @norbital-ai/doctor. Name no registered pack here — stringly rules
// plus the Bolt health profile are the template contract. FILE1/EXP1 stay in
// doctor's baseline graph pack and use the profile below.
export default defineConfig({
	packs: [stringlyPack],
	// FILE1/EXP1 walk the static import graph. Bolt loads `+model`, `+definition`,
	// `*.host.ts`, and `.svelte` by convention — without these roots the isolate
	// audit treats the whole workspace as unreachable and fails provision.
	profile: {
		frameworkEntries: [
			'(?:^|/)(?:hooks(?:\\.server|\\.client)?|\\+[^/]*)\\.[cm]?[jt]sx?$',
			'(?:^|/)[^/]*\\.host\\.[cm]?[jt]s$',
			'(?:^|/)src/(?:env|params|hooks|service-worker)\\.[cm]?[jt]s$',
			'\\.svelte$'
		],
		serviceHeritage: [
			'(?:Effect|Context|ServiceMap)\\.Service',
			'(?:Context|ServiceMap)\\.(?:(?:Generic)?Tag|Service)\\s*(?:<[^;]+?>)?\\s*\\('
		],
		genericLabels: ['effect', 'gen', 'succeed']
	}
});
