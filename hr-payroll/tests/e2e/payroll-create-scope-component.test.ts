// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
const mocks = vi.hoisted(() => ({
	runs: [] as { company_id: string; period: string; kind: string }[],
	act: vi.fn()
}));
vi.mock('$bolt', () => ({
	bolt: {
		locale: 'en',
		read: (collection: string) => ({
			current:
				collection === 'companies'
					? [{ id: 'company', name: 'Company', pay_frequency: 'MONTHLY', pay_cutoff_day: 1 }]
					: mocks.runs,
			loading: false,
			error: null
		})
	}
}));
vi.mock('../../src/lib/ui/live.svelte.js', () => ({
	liveRows: (read: () => unknown) => read(),
	live: () => ({ current: null })
}));
vi.mock('../../src/lib/ui/t.js', () => ({ t: (key: string) => key }));
vi.mock('@norbital-ai/ui', async () => {
	const { default: Wrapper } = await import('./fixtures/payroll-scope/wrapper.svelte');
	const { default: Form } = await import('./fixtures/payroll-scope/form.svelte');
	const { default: Field } = await import('./fixtures/payroll-scope/field.svelte');
	const { default: Combobox } = await import('./fixtures/payroll-scope/combobox.svelte');
	return {
		Form,
		Field,
		Combobox,
		RecordShell: Wrapper,
		Section: Wrapper,
		Picker: Wrapper,
		Popover: {},
		Table: Wrapper
	};
});
vi.mock('@norbital-ai/ui/layout', async () => {
	const { default: Wrapper } = await import('./fixtures/payroll-scope/wrapper.svelte');
	return { Cluster: Wrapper, Cover: Wrapper, Grid: Wrapper, Scroll: Wrapper, Stack: Wrapper };
});
import Representation from '../../src/data/collection/payroll_runs/+representation.svelte';
import { HR_CREATE_SCOPE } from '../../src/lib/ui/create-scope.js';
let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	mocks.runs = [];
});
function render(period?: string, kind = 'REGULAR') {
	component = mount(Representation, {
		target: document.body,
		context: new Map([
			[
				HR_CREATE_SCOPE,
				{ companyId: () => 'company', settingsCode: () => 'MY', payrollPeriod: () => period }
			]
		]),
		props: {
			view: {
				collection: 'payroll_runs',
				mode: 'create',
				values: { kind, period: '2026-02' }
			} as never
		}
	});
}
it('keeps selected January hidden even when February was supplied to the create view', async () => {
	render('2026-01');
	await tick();
	expect(document.querySelector('[data-field=period]')).toBeNull();
	expect(JSON.parse(document.querySelector('[data-create-values]')!.textContent!).period).toBe(
		'2026-01'
	);
	expect(document.querySelector<HTMLButtonElement>('[data-create-submit]')!.disabled).toBe(false);
});
it('blocks duplicate January regular without changing period and lets FINAL remain selectable', async () => {
	mocks.runs = [{ company_id: 'company', period: '2026-01', kind: 'REGULAR' }];
	render('2026-01');
	await tick();
	expect(document.querySelector<HTMLButtonElement>('[data-create-submit]')!.disabled).toBe(true);
	expect(document.body.textContent).toContain('component.payroll_regular_exists_help');
	const kind = document.querySelector<HTMLSelectElement>('[aria-label="app.payroll.kind"]')!;
	kind.value = 'FINAL';
	expect(kind.value).toBe('FINAL');
	kind.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
	expect(document.querySelector<HTMLButtonElement>('[data-create-submit]')!.disabled).toBe(false);
	expect(JSON.parse(document.querySelector('[data-create-values]')!.textContent!).period).toBe(
		'2026-01'
	);
});
it('keeps ad hoc January allowed beside an existing regular run', async () => {
	mocks.runs = [{ company_id: 'company', period: '2026-01', kind: 'REGULAR' }];
	render('2026-01', 'OFF_CYCLE');
	await tick();
	expect(document.querySelector<HTMLButtonElement>('[data-create-submit]')!.disabled).toBe(false);
	expect(JSON.parse(document.querySelector('[data-create-values]')!.textContent!).period).toBe(
		'2026-01'
	);
});
it('keeps the period selector when no header period context exists', async () => {
	render();
	await tick();
	expect(document.querySelector('[data-field=period]')).not.toBeNull();
});
