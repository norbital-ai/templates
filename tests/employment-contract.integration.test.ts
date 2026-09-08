import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import {
	startPublicSeedHost,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS
} from './helpers/public-seed-host.ts';

const contracts = JSON.parse(
	readFileSync(new URL('./fixtures/seed/employments.json', import.meta.url), 'utf8')
) as Record<string, unknown>[];
const terms = JSON.parse(
	readFileSync(new URL('./fixtures/seed/employment_terms.json', import.meta.url), 'utf8')
) as Record<string, unknown>[];

test(
	'first contract reference seals atomically, prevents reassignment and survives consumer deletion; rehire retains the employee number',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('contract-seal');
		try {
			const headers = bearerHeaders(session.credential);
			const command = (
				body: Parameters<typeof mutationPush>[1],
				bases: Parameters<typeof mutationPush>[2] = []
			) =>
				postGuestCommand(
					session.host.baseUrl,
					'collections.mutate',
					mutationPush(session.schemaFingerprint, body, bases),
					headers
				);

			const makeContract = (id: string, company_id = contracts[0].company_id) => ({
				...contracts[0],
				id,
				company_id,
				hire_date: '2026-06-01',
				effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
			});
			const overlap = await command({
				action: 'mutate',
				collection: 'employments',
				rows: [{ action: 'create', values: makeContract(crypto.randomUUID()) }]
			});
			assert.notEqual(asRecord(overlap.value, 'same entity overlap').resolution, 'accepted');
			assert.match(JSON.stringify(overlap.value), /active employment contract/i);
			const companies = JSON.parse(
				readFileSync(new URL('./fixtures/seed/companies.json', import.meta.url), 'utf8')
			) as Record<string, unknown>[];
			const otherCompanyId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'companies',
						rows: [
							{
								action: 'create',
								values: {
									...companies[0],
									id: otherCompanyId,
									name: 'Second Fixture Entity',
									registration_number: 'PUB-CO-SECOND'
								}
							}
						]
					})
				).value
			);
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'employments',
						rows: [{ action: 'create', values: makeContract(crypto.randomUUID(), otherCompanyId) }]
					})
				).value
			);
			const recordDeparture = async (id: string, exit_date: string) => {
				const [row] = await session.query('select row_version from employments where id = $1', [
					id
				]);
				return command(
					{
						action: 'mutate',
						collection: 'employments',
						rows: [{ action: 'update', values: { id, exit_date, exit_reason: 'RESIGNATION' } }]
					},
					[
						{
							row: { collection: 'employments', recordId: id },
							rowVersion: Number(row.row_version)
						}
					]
				);
			};
			requireAccepted(
				(await recordDeparture(String(contracts[0].id), '2026-05-31')).value,
				'departure'
			);
			const batched = await command({
				action: 'mutate',
				collection: 'employments',
				rows: [crypto.randomUUID(), crypto.randomUUID()].map((id) => ({
					action: 'create',
					values: makeContract(id)
				}))
			});
			assert.notEqual(asRecord(batched.value, 'overlapping batch').resolution, 'accepted');
			const competingIds = [crypto.randomUUID(), crypto.randomUUID()];
			const competing = await Promise.all(
				competingIds.map((id, index) =>
					command({
						action: 'mutate',
						collection: 'employments',
						rows: [
							{
								action: 'create',
								values: {
									...makeContract(id),
									hire_date: `2026-06-0${index + 1}`,
									effective_range: { start: `2026-06-0${index + 1}T00:00:00.000Z`, end: null }
								}
							}
						]
					})
				)
			);
			const accepted = competing.flatMap((result, index) =>
				asRecord(result.value, 'concurrent contract').resolution === 'accepted' ? [index] : []
			);
			assert.equal(accepted.length, 1, JSON.stringify(competing.map((result) => result.value)));
			const contractId = competingIds[accepted[0]];

			const termId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'employment_terms',
						rows: [
							{
								action: 'create',
								values: {
									...terms[0],
									id: termId,
									employment_id: contractId,
									effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
								}
							}
						]
					})
				).value
			);
			const seals = await session.query(
				'select * from employment_contract_inputs where employment_id = $1',
				[contractId]
			);
			assert.equal(seals.length, 1);
			assert.equal(seals[0].employment_terms_id, termId);
			const [contract] = await session.query('select * from employments where id = $1', [
				contractId
			]);
			const contractBase = [
				{
					row: { collection: 'employments', recordId: contractId },
					rowVersion: Number(contract.row_version)
				}
			];
			const edit = await command(
				{
					action: 'mutate',
					collection: 'employments',
					rows: [{ action: 'update', values: { id: contractId, employee_number: 'CHANGED' } }]
				},
				contractBase
			);
			assert.notEqual(asRecord(edit.value, 'sealed edit').resolution, 'accepted');
			assert.match(JSON.stringify(edit.value), /sealed/i);
			const [term] = await session.query('select * from employment_terms where id = $1', [termId]);
			const termBase = [
				{
					row: { collection: 'employment_terms', recordId: termId },
					rowVersion: Number(term.row_version)
				}
			];
			const move = await command(
				{
					action: 'mutate',
					collection: 'employment_terms',
					rows: [
						{ action: 'update', values: { id: termId, employment_id: String(contracts[0].id) } }
					]
				},
				termBase
			);
			assert.notEqual(asRecord(move.value, 'event move').resolution, 'accepted');
			assert.match(JSON.stringify(move.value), /another employment contract/i);
			requireAccepted(
				(
					await command(
						{ action: 'delete', collection: 'employment_terms', ids: [termId] },
						termBase
					)
				).value
			);
			assert.equal(
				(
					await session.query(
						'select id from employment_contract_inputs where employment_id = $1',
						[contractId]
					)
				).length,
				1
			);
			const remove = await command(
				{ action: 'delete', collection: 'employments', ids: [contractId] },
				contractBase
			);
			assert.notEqual(asRecord(remove.value, 'sealed delete').resolution, 'accepted');
			const removeSeal = await command(
				{ action: 'delete', collection: 'employment_contract_inputs', ids: [String(seals[0].id)] },
				[
					{
						row: { collection: 'employment_contract_inputs', recordId: String(seals[0].id) },
						rowVersion: Number(seals[0].row_version)
					}
				]
			);
			assert.notEqual(asRecord(removeSeal.value, 'seal delete').resolution, 'accepted');
			assert.equal(
				(
					await session.query('select id from employments where employee_id = $1', [
						contracts[0].employee_id
					])
				).length,
				3
			);
			requireAccepted((await recordDeparture(contractId, '2026-07-31')).value, 'sealed departure');
			const redeparture = await recordDeparture(contractId, '2026-08-15');
			assert.notEqual(asRecord(redeparture.value, 'edit departure').resolution, 'accepted');
			assert.match(JSON.stringify(redeparture.value), /departure cannot be edited/i);
			const nestedContractId = crypto.randomUUID();
			const nestedTermId = crypto.randomUUID();
			const { employment_id: _oldContract, id: _oldTerm, ...nestedTerms } = terms[0];
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'employments',
						rows: [
							{
								action: 'create',
								values: {
									...makeContract(nestedContractId),
									hire_date: '2026-08-01',
									effective_range: { start: '2026-08-01T00:00:00.000Z', end: null },
									term_employment: [
										{
											...nestedTerms,
											id: nestedTermId,
											effective_range: { start: '2026-08-01T00:00:00.000Z', end: null }
										}
									]
								}
							}
						]
					})
				).value
			);
			const nestedSeals = await session.query(
				'select * from employment_contract_inputs where employment_id = $1',
				[nestedContractId]
			);
			assert.equal(nestedSeals.length, 1);
			assert.equal(nestedSeals[0].employment_terms_id, nestedTermId);

			// A committed Work date keeps term history sealed even after the source is removed.
			const workId = crypto.randomUUID();
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'work_days',
						rows: [
							{
								action: 'create',
								values: {
									id: workId,
									employment_id: nestedContractId,
									work_date: '2026-08-03',
									worked_intervals: null,
									break_minutes: 0
								}
							}
						]
					})
				).value
			);
			const [workSeal] = await session.query(
				"select to_char(terms_through at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') as terms_through from employment_contract_inputs where work_days_id = $1",
				[workId]
			);
			assert.equal(workSeal.terms_through, '2026-08-03');
			const updateTerms = async (values: Record<string, unknown>) => {
				const [row] = await session.query(
					'select row_version from employment_terms where id = $1',
					[nestedTermId]
				);
				return command(
					{
						action: 'mutate',
						collection: 'employment_terms',
						rows: [{ action: 'update', values: { id: nestedTermId, ...values } }]
					},
					[
						{
							row: { collection: 'employment_terms', recordId: nestedTermId },
							rowVersion: Number(row.row_version)
						}
					]
				);
			};
			const drift = await updateTerms({ residency_status: 'FOREIGNER' });
			assert.notEqual(asRecord(drift.value, 'consumed term change').resolution, 'accepted');
			assert.match(JSON.stringify(drift.value), /consumed/);
			const [work] = await session.query('select row_version from work_days where id = $1', [
				workId
			]);
			requireAccepted(
				(
					await command({ action: 'delete', collection: 'work_days', ids: [workId] }, [
						{
							row: { collection: 'work_days', recordId: workId },
							rowVersion: Number(work.row_version)
						}
					])
				).value
			);
			assert.match(
				JSON.stringify((await updateTerms({ residency_status: 'FOREIGNER' })).value),
				/consumed/
			);
			requireAccepted(
				(
					await updateTerms({
						effective_range: {
							start: '2026-08-01T00:00:00.000Z',
							end: '2026-08-31T00:00:00.000Z'
						}
					})
				).value
			);
			const successorId = crypto.randomUUID();
			const successor = (start: string) => ({
				...nestedTerms,
				id: successorId,
				employment_id: nestedContractId,
				residency_status: 'FOREIGNER',
				effective_range: { start: `${start}T00:00:00.000Z`, end: null }
			});
			const sharedDay = await command({
				action: 'mutate',
				collection: 'employment_terms',
				rows: [{ action: 'create', values: successor('2026-08-31') }]
			});
			assert.notEqual(asRecord(sharedDay.value, 'inclusive term overlap').resolution, 'accepted');
			assert.match(
				JSON.stringify(sharedDay.value),
				/employment_terms_no_overlap|exclusion constraint/i,
				'shared-day terms must reach the overlap constraint rather than fail wire validation'
			);
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'employment_terms',
						rows: [{ action: 'create', values: successor('2026-09-01') }]
					})
				).value
			);
			const [oneDay] = await session.query(
				"select daterange(lower(bolt_daterange($1::jsonb - 'end')), upper(bolt_daterange($1::jsonb - 'start')), '[]') = daterange('2026-09-01', '2026-09-02', '[)') as exact",
				[
					JSON.stringify({
						start: '2026-09-01T00:00:00.000Z',
						end: '2026-09-01T00:00:00.000Z'
					})
				]
			);
			assert.equal(
				oneDay.exact,
				true,
				'single-day terms must neither disappear nor become an unbounded range'
			);
		} finally {
			await session.stop();
		}
	}
);
