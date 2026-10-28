/**
 * The payroll hotline (`+payroll_hotline.envoy.ts`, `dm: 'envoy'`) on the test kit's fake WhatsApp links, with a
 * scripted model. Two entities name their own WhatsApp instance as `entity.hotline` (HR attaches one), and HR
 * deploys the envoy on each through an ordinary `sys_integration` update. A turn reads only the sender's own
 * payslips of the entity whose number they wrote to; an administrator's DM holds the envoy's policy alone (no write,
 * no bypass); an unknown number gets the fixed notice and no turn; a group message is ignored.
 */
import { describe, expect, it } from '@effect/vitest';
import { Context, Effect, FiberSet, Layer, Schema } from 'effect';
import {
	Ai,
	type AiPort,
	type AiRequest,
	type AiResponse,
	type Json
} from '@norbital-ai/bolt/engine';
import { respondSystem1, TestWorkspace } from '@norbital-ai/bolt/test';
import type { InstanceId } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { workspace } from '../kit.ts';
import { nativeId } from '../fixture_values.ts';

const id = (n: number) => `019f9c00-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [HOTLINE_A, HOTLINE_B] = [id(1), id(2)];
const [SG, A, B] = [id(3), id(4), id(5)];
const [P_ADA, P_CAL, P_DEE] = [id(6), id(7), id(8)];
const [K_ADA_A, K_CAL_A, K_CAL_B, K_DEE_A] = [id(9), id(10), id(11), id(12)];
const [RUN_A, RUN_B] = [id(13), id(14)];
const [SLIP_ADA_A, SLIP_CAL_A, SLIP_CAL_B, SLIP_DEE_A] = [id(15), id(16), id(17), id(18)];
const [ADA, CAL, DEE] = [id(19), id(20), id(21)];
const OPEN = { from: '2026-01-01', to: null };

const contract = (key: string, employee: string, company: string, n: string) => ({
	id: key,
	employee_id: employee,
	company_id: company,
	employee_number: n,
	contract_number: 1,
	effective_range: OPEN,
	facts: {}
});
const slip = (key: string, run: string, employment: string, net: string) => ({
	id: key,
	payroll_run_id: run,
	employment_id: employment,
	terms_through: '2026-09-30',
	salary_from: '2026-09-01',
	salary_to: '2026-09-30',
	status: 'DRAFT',
	currency: 'SGD',
	gross: net,
	total_deductions: '0.00',
	net,
	employer_cost: net
});
/** Two entities, each with its own hotline; Cal works for both, Ada (an administrator) and Dee for A only. */
const seed = {
	sys_user: [
		{
			id: ADA,
			email: 'ada@hr.test',
			name: 'Ada',
			kind: 'staff',
			admin: true,
			phone: '+65 9123 4567'
		},
		{
			id: CAL,
			email: 'cal@hr.test',
			name: 'Cal',
			kind: 'staff',
			admin: false,
			phone: '6598765432'
		},
		{ id: DEE, email: 'dee@hr.test', name: 'Dee', kind: 'staff', admin: false, phone: '6597654321' }
	],
	sys_integration: [
		{ id: HOTLINE_A, integration: 'whatsapp', name: 'Acme SG payroll' },
		{ id: HOTLINE_B, integration: 'whatsapp', name: 'Acme MY payroll' }
	],
	jurisdiction_settings: [
		{
			id: SG,
			code: 'SG',
			jurisdiction_code: 'SG',
			name: 'Singapore',
			effective_range: OPEN,
			payroll: {},
			sources: { entries: [] }
		}
	],
	entity: [
		{
			id: A,
			settings_code: 'SG',
			name: 'Acme SG',
			pay_cutoff_day: 1,
			effective_range: OPEN,
			hotline: HOTLINE_A
		},
		{
			id: B,
			settings_code: 'SG',
			name: 'Acme MY',
			pay_cutoff_day: 1,
			effective_range: OPEN
		}
	],
	employment_profile: [
		{ id: P_ADA, name: 'Ada', user_id: ADA },
		{ id: P_CAL, name: 'Cal', user_id: CAL },
		{ id: P_DEE, name: 'Dee', user_id: DEE }
	],
	employment_contract: [
		contract(K_ADA_A, P_ADA, A, 'A-1'),
		contract(K_CAL_A, P_CAL, A, 'A-2'),
		contract(K_CAL_B, P_CAL, B, 'B-1'),
		contract(K_DEE_A, P_DEE, A, 'A-3')
	],
	payroll_run: [
		{ id: RUN_A, company_id: A, settings_id: SG, period: '2026-09' },
		{ id: RUN_B, company_id: B, settings_id: SG, period: '2026-09' }
	],
	payslip: [
		slip(SLIP_ADA_A, RUN_A, K_ADA_A, '3000.00'),
		slip(SLIP_CAL_A, RUN_A, K_CAL_A, '1000.00'),
		slip(SLIP_CAL_B, RUN_B, K_CAL_B, '2000.00'),
		slip(SLIP_DEE_A, RUN_A, K_DEE_A, '4000.00')
	]
};

/** The model: "slips" reads payslips, "hold <id>" puts one on hold; a tool result ends the turn with "Done.". */
const present = <A>(value: A | null | undefined): A => {
	if (value === null || value === undefined)
		throw new Error('Missing payroll hotline fixture value');
	return value;
};
const scripted = Effect.gen(function* () {
	const requests: AiRequest[] = [];
	const run = yield* FiberSet.makeRuntimePromise();
	let n = 0;
	const usage = { input: 1, output: 1 };
	const text = (content: Json) => (typeof content === 'string' ? content : JSON.stringify(content));
	const call = (name: string, input: Json): AiResponse => ({
		content: '',
		toolCalls: [{ id: `c${++n}`, name, input }],
		finish: 'tool',
		usage
	});
	const provider: AiPort = {
		sys_1: { ask: (request, signal) => run(respondSystem1(request), { signal }) },
		sys_2: {
			models: ['default', 'strong'],
			async infer(request, signal) {
				signal.throwIfAborted();
				requests.push(request);
				const last = present(
					request.messages.findLast(
						(message) =>
							!(
								typeof message.content === 'string' &&
								message.content.startsWith('[conversation state')
							)
					)
				);
				if (last.role === 'tool') return { content: 'Done.', toolCalls: [], finish: 'stop', usage };
				const said = text(last.content);
				if (/^(?:\[[^\]\n]*\] )?slips$/m.test(said)) return call('read', { payslip: {} });
				const hold = /^(?:\[[^\]\n]*\] )?hold (\S+)$/m.exec(said);
				if (hold !== null)
					return call('act', {
						callable: 'payslip.update',
						input: [{ target: present(hold[1]), set: { status: 'ON_HOLD' } }]
					});
				return { content: `echo: ${said}`, toolCalls: [], finish: 'stop', usage };
			}
		}
	};
	return { requests, layer: Ai.fromAbi(provider) };
});

const Row = Schema.Record(Schema.String, Schema.Json);
const PayslipResult = Schema.Struct({
	payslip: Schema.Struct({
		rows: Schema.Array(Schema.Struct({ net: Schema.Struct({ $dec: Schema.String }) }))
	})
});
const Notice = Schema.Struct({ to: Schema.String, text: Schema.String });
const setup = Effect.gen(function* () {
	const ai = yield* scripted;
	const context = yield* Layer.build(
		workspace({ seed, ports: ai.layer, now: '2026-10-01T02:00:00.000Z' })
	);
	const t = Context.get(context, TestWorkspace);
	// HR attaches B's number and deploys the envoy through the same ordinary writes as the entity page.
	const hr = t.as(t.member(['hr_manager']));
	const hotline = Schema.decodeUnknownSync(
		Schema.declare<InstanceId<'whatsapp'>>(
			(value): value is InstanceId<'whatsapp'> =>
				typeof value === 'string' &&
				Schema.is(inputSchema({ kind: 'id', of: 'sys_integration' }))(value) &&
				seed.sys_integration.some((row) => row.id === value && row.integration === 'whatsapp')
		)
	)(HOTLINE_B);
	const attached = yield* hr.act('entity.update', [
		{
			target: nativeId('entity', B),
			set: { hotline }
		}
	]);
	expect(attached.kind, JSON.stringify(attached)).toBe('committed');
	for (const target of [HOTLINE_A, HOTLINE_B]) {
		const deployed = yield* hr.act('sys_integration.update', [
			{
				target: nativeId('sys_integration', target),
				set: { envoy: 'payroll_hotline' }
			}
		]);
		expect(deployed.kind, JSON.stringify(deployed)).toBe('committed');
	}
	let seq = 0;
	/** One provider DM or group message, through the native ingest and bounded turn lifetime. */
	const say = Effect.fn('Test.payrollHotlineSay')(function* (
		instance: string,
		phone: string,
		text: string,
		group?: string
	) {
		const jid = `${phone}@s.whatsapp.net`,
			message = `H${++seq}`;
		yield* t.receive(instance, {
			id: message,
			thread: group ?? jid,
			sentAt: t.clock.now(),
			from: { handle: jid, name: null },
			group: group !== undefined,
			text,
			replyTo: null,
			invocation: group === undefined ? 'direct' : 'mention',
			attachments: []
		});
		t.clock.advance('2s'); // the trailing pause before a turn (P40)
		yield* t.runDue();
		yield* t.settled();
		return message;
	});
	const rows = (text: string, params: readonly Json[] = []) => t.db.rows(Row, { text, params });
	/** What the native turn's authority allowed its latest tool to return. */
	const lastResult = rows(
		`SELECT content->'result' AS result FROM sys_message WHERE role = 'tool' ORDER BY seq DESC LIMIT 1`
	).pipe(Effect.map((values) => values[0]?.['result']));
	const inbound = (message: string) =>
		rows(
			`SELECT role, addressed, refused FROM sys_message WHERE direction = 'inbound' AND provider_id = $1`,
			[message]
		).pipe(Effect.map((values) => present(values[0])));
	return { t, ai, say, lastResult, inbound };
});
/** The canonical tool result carries decimal values as {$dec}; a malformed answer fails the scenario. */
const nets = (result: Json | undefined) =>
	Schema.decodeUnknownSync(PayslipResult)(result)
		.payslip.rows.map((row) => row.net.$dec)
		.sort();

describe('payroll hotline', () => {
	it.live(
		"answers a member's own payslip on the right entity's number, and nothing on another entity's",
		() =>
			Effect.gen(function* () {
				const { t, say, lastResult } = yield* setup;
				yield* say(HOTLINE_A, '6598765432', 'slips');
				expect(nets(yield* lastResult)).toEqual(['1000.00']);
				yield* say(HOTLINE_B, '6598765432', 'slips');
				expect(nets(yield* lastResult)).toEqual(['2000.00']);
				// Dee works for A only: B's number reads nothing of hers or anyone else's.
				yield* say(HOTLINE_B, '6597654321', 'slips');
				expect(yield* lastResult).toMatchObject({ payslip: { rows: [] } });
				yield* say(HOTLINE_A, '6597654321', 'slips');
				expect(nets(yield* lastResult)).toEqual(['4000.00']);
				expect([...new Set(t.fakes.links.sent.map((sent) => sent.instance))].sort()).toEqual(
					[HOTLINE_A, HOTLINE_B].sort()
				);
			})
	);

	it.live(
		"an administrator's DM holds the hotline policy alone: her own payslip, and no write",
		() =>
			Effect.gen(function* () {
				const { t, say, lastResult } = yield* setup;
				yield* say(HOTLINE_A, '6591234567', 'slips');
				expect(nets(yield* lastResult)).toEqual(['3000.00']);
				yield* say(HOTLINE_A, '6591234567', `hold ${SLIP_ADA_A}`);
				expect(yield* lastResult).toEqual({ error: "No tool 'act'." });
				expect(
					(
						(yield* t
							.as(t.admin)
							.query({ payslip: { where: { id: { eq: nativeId('payslip', SLIP_ADA_A) } } } }))
							.payslip.rows[0] ?? null
					)?.status
				).toBe('DRAFT');
			})
	);

	it.live('an unknown number gets the fixed notice and no turn', () =>
		Effect.gen(function* () {
			const { t, ai, say, inbound } = yield* setup;
			const message = yield* say(HOTLINE_A, '6599999999', 'what is my salary?');
			expect(yield* inbound(message)).toMatchObject({ refused: 'unregistered' });
			expect(ai.requests).toHaveLength(0);
			const notice = Schema.decodeUnknownSync(Notice)(
				t.fakes.links.sent.findLast((sent) => sent.instance === HOTLINE_A)?.message
			);
			expect(notice.to).toBe('6599999999@s.whatsapp.net');
			expect(notice.text).toMatch(/is not recognised/);
		})
	);

	it.live('ignores group messages, even one that mentions it', () =>
		Effect.gen(function* () {
			const { t, ai, say, inbound } = yield* setup;
			const message = yield* say(HOTLINE_A, '6598765432', 'slips', '120363@g.us');
			expect(yield* inbound(message)).toEqual({ role: null, addressed: null, refused: null });
			expect(ai.requests).toHaveLength(0);
			expect(t.fakes.links.sent).toEqual([]);
		})
	);
});
