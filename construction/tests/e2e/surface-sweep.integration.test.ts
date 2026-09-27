// @vitest-environment happy-dom
/**
 * Every app page renders for every team: the real shell over a test-kit workspace built from this template and
 * seeded with its public base pack, one member per team's policies and an administrator, every page their navigation
 * offers. A console error, a thrown page or an over-budget live view is a finding.
 */
import type { Component } from 'svelte';
import { expect, it } from 'vitest';
import { testWorkspace } from '@norbital-ai/bolt/test';
import { sweep } from '@norbital-ai/bolt/test/browser';
import teams from '../../src/access/+team.ts';

/** `src/app/<app>/+<page>.page.svelte` as the shell names it, `<app>/<page>`. */
const pages = Object.fromEntries(
	Object.entries(import.meta.glob<{ default: Component }>('../../src/app/**/+*.page.svelte')).map(
		([path, load]) => [
			path.replace(/^\.\.\/\.\.\/src\/app\//, '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
			load
		]
	)
);

it('every app page renders for every team with no console error and no over-budget view', async () => {
	const t = await testWorkspace({ root: process.cwd() });
	const report = await sweep(t, {
		pages,
		as: [{ admin: true }, ...Object.values(teams).map((policies) => ({ policies }))]
	});
	expect(report.visited.map((visit) => visit.path)).toEqual(
		expect.arrayContaining([
			'/app/construction_project_workspace/projects',
			'/app/construction_settings_reference_matrix/matrix',
			'/app/construction_settings_workforce/workforce'
		])
	);
	expect(report.findings).toEqual([]);
});
