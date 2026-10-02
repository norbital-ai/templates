// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
const mocks = vi.hoisted(() => ({ act: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('$bolt', () => ({
	bolt: {
		read: (collection: string) => ({
			current:
				collection === 'adhoc_catalogue'
					? [{ code: 'BONUS', name: 'Bonus' }]
					: collection === 'adhoc_requests'
						? ['a', 'b'].map((id) => ({
								id: `source-${id}`,
								employment_id: { id, employee_id: { name: `Person ${id}` }, employee_number: id },
								catalogue_id: { code: 'BONUS', name: 'Bonus' },
								amount: 100,
								event_date: '2026-01-20'
							}))
						: [],
			loading: false,
			error: null
		}),
		act: mocks.act
	}
}));
vi.mock('../../src/lib/ui/live.svelte.js', () => ({ liveRows: (read: () => unknown) => read() }));
vi.mock('../../src/lib/ui/t.js', () => ({ t: (key: string) => key }));
vi.mock('svelte-sonner', () => ({ toast: mocks }));
vi.mock('@norbital-ai/ui', async () => {
	const { default: Wrapper } = await import('./fixtures/payroll-scope/wrapper.svelte');
	const { default: Button } = await import('./fixtures/payroll-scope/button.svelte');
	const { default: Checkbox } = await import('./fixtures/payroll-scope/checkbox.svelte');
	const { default: Combobox } = await import('./fixtures/payroll-scope/combobox.svelte');
	return {
		Button,
		Checkbox,
		Combobox,
		Badge: Wrapper,
		EmptyState: Wrapper,
		Dialog: { Root: Wrapper, Content: Wrapper, Header: Wrapper, Title: Wrapper }
	};
});
vi.mock('@norbital-ai/ui/layout', async () => {
	const { default: Wrapper } = await import('./fixtures/payroll-scope/wrapper.svelte');
	return { Cluster: Wrapper, Inline: Wrapper, Scroll: Wrapper, Stack: Wrapper };
});
import OffCycle from '../../src/app/hr_controller/payroll/off-cycle-run.svelte';
let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.clearAllMocks();
});
function button(text: string) {
	return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	)!;
}
async function start() {
	mocks.act.mockResolvedValue({ kind: 'committed', records: [] });
	component = mount(OffCycle, {
		target: document.body,
		props: {
			open: true,
			companyId: 'company',
			settingsCode: 'MY',
			period: '2026-01',
			cycleRuns: [],
			cycleSlips: []
		} as never
	});
	await tick();
	button('Bonus').click();
	await tick();
}
async function pick(id: string) {
	const select = document.querySelector<HTMLSelectElement>(
		'[aria-label="app.payroll.adhoc_people"]'
	)!;
	select.value = id;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
}
it('requires an explicit person and sends only that person sources in the selected January period', async () => {
	await start();
	expect(button('app.payroll.create_run').disabled).toBe(true);
	await pick('a');
	expect(button('app.payroll.create_run').disabled).toBe(false);
	button('app.payroll.create_run').click();
	await tick();
	expect(mocks.act).toHaveBeenCalledWith('payroll_runs.create', {
		company_id: 'company',
		period: '2026-01',
		kind: 'OFF_CYCLE',
		sources: ['source-a']
	});
});
it('supports a group and preserves per-entry unticking within it', async () => {
	await start();
	await pick('a');
	await pick('b');
	const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
	expect(boxes).toHaveLength(4);
	boxes[3]!.checked = false;
	boxes[3]!.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
	button('app.payroll.create_run').click();
	await tick();
	expect(mocks.act.mock.calls[0]?.[1].sources).toEqual(['source-a']);
});
it('removing a chosen person also removes their sources from the group payload', async () => {
	await start();
	await pick('a');
	await pick('b');
	const remove = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.includes('Person a') && b.textContent?.includes('×')
	)!;
	remove.click();
	await tick();
	button('app.payroll.create_run').click();
	await tick();
	expect(mocks.act.mock.calls[0]?.[1].sources).toEqual(['source-b']);
});
