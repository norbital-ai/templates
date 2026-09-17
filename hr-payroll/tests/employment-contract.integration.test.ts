import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asRecord, bearerHeaders, requireAccepted } from '@norbital-ai/test-utilities';
import { createdIds, graphOf, writeGraph } from './helpers/write.ts';
import { leaveTeamHeaders } from './helpers/public-leave.ts';
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
			const command = (body: Parameters<typeof graphOf>[0], bases = []) =>
				writeGraph(session, body, bases, headers);

			// A new contract states the person, the entity and the range; its number is derived.
			const { id: _seedId, contract_number: _seedNumber, ...seedContract } = contracts[0];
			const makeContract = (company_id = contracts[0].company_id) => ({
				...seedContract,
				company_id,
				effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
			});
			const overlap = await command({
				action: 'mutate',
				collection: 'employments',
				rows: [{ action: 'create', values: makeContract() }]
			});
			assert.notEqual(asRecord(overlap.value, 'same entity overlap').resolution, 'accepted');
			assert.match(JSON.stringify(overlap.value), /active employment contract/i);
			const companies = JSON.parse(
				readFileSync(new URL('./fixtures/seed/companies.json', import.meta.url), 'utf8')
			) as Record<string, unknown>[];
			const { id: _seedCompany, ...seedCompany } = companies[0];
			const otherCompany = await command({
				action: 'mutate',
				collection: 'companies',
				rows: [
					{
						action: 'create',
						values: {
							...seedCompany,
							name: 'Second Fixture Entity',
							registration_number: 'PUB-CO-SECOND'
						}
					}
				]
			});
			requireAccepted(otherCompany.value);
			const [otherCompanyId] = createdIds(otherCompany.value);
			requireAccepted(
				(
					await command({
						action: 'mutate',
						collection: 'employments',
						rows: [{ action: 'create', values: makeContract(otherCompanyId) }]
					})
				).value
			);
			const recordDeparture = async (id: string, end: string) => {
				const [row] = await session.query(
					'select row_version, effective_range from employments where id = $1',
					[id]
				);
				const start =
					typeof row.effective_range === 'string'
						? JSON.parse(row.effective_range).start
						: row.effective_range.start;
				// instant_range bounds are instants: a bare YYYY-MM-DD day becomes its midnight.
				if (/^\d{4}-\d{2}-\d{2}$/.test(end)) end = `${end}T00:00:00.000Z`;
				return command(
					{
						action: 'mutate',
						collection: 'employments',
						rows: [{ action: 'update', values: { id, effective_range: { start, end } } }]
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
				rows: [makeContract(), makeContract()].map((values) => ({ action: 'create', values }))
			});
			assert.notEqual(asRecord(batched.value, 'overlapping batch').resolution, 'accepted');
			const competing = await Promise.all(
				[1, 2].map((day) =>
					command({
						action: 'mutate',
						collection: 'employments',
						rows: [
							{
								action: 'create',
								values: {
									...makeContract(),
									effective_range: { start: `2026-06-0${day}T00:00:00.000Z`, end: null }
								}
							}
						]
					})
				)
			);
			const accepted = competing.filter(
				(result) => asRecord(result.value, 'concurrent contract').resolution === 'accepted'
			);
			assert.equal(accepted.length, 1, JSON.stringify(competing.map((result) => result.value)));
			const [contractId] = createdIds(accepted[0].value);

			const { id: _seedTermId, ...seedTerms } = terms[0];
			const term = await command({
				action: 'mutate',
				collection: 'employment_terms',
				rows: [
					{
						action: 'create',
						values: {
							...seedTerms,
							employment_id: contractId,
							effective_range: { start: '2026-06-01T00:00:00.000Z', end: null }
						}
					}
				]
			});
			requireAccepted(term.value);
			const [termId] = createdIds(term.value);
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
			const [storedTerm] = await session.query('select * from employment_terms where id = $1', [
				termId
			]);
			const termBase = [
				{
					row: { collection: 'employment_terms', recordId: termId },
					rowVersion: Number(storedTerm.row_version)
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
			// The term is the seal: while it stands the contract cannot go. The delete grant decides
			// it, so the request is made as the team the grant binds; the founder bypasses policy.
			const remove = await writeGraph(
				session,
				{ action: 'delete', collection: 'employments', ids: [contractId] },
				contractBase,
				leaveTeamHeaders(session, 'HR Manager')
			);
			assert.notEqual(asRecord(remove.value, 'sealed delete').resolution, 'accepted');
			requireAccepted(
				(
					await command(
						{ action: 'delete', collection: 'employment_terms', ids: [termId] },
						termBase
					)
				).value,
				'term delete'
			);
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
			assert.match(JSON.stringify(redeparture.value), /cannot be reopened/i);
			const { employment_id: _oldContract, id: _oldTerm, ...nestedTerms } = terms[0];
			const nested = await command({
				action: 'mutate',
				collection: 'employments',
				rows: [
					{
						action: 'create',
						values: {
							...makeContract(),
							effective_range: { start: '2026-08-01T00:00:00.000Z', end: null },
							term_employment: {
								create: [
									{
										...nestedTerms,
										effective_range: { start: '2026-08-01T00:00:00.000Z', end: null }
									}
								]
							}
						}
					}
				]
			});
			requireAccepted(nested.value);
			const [nestedContractId] = createdIds(nested.value);
			const [nestedTerm] = (await session.query(
				'select id from employment_terms where employment_id = $1',
				[nestedContractId]
			)) as ReadonlyArray<{ readonly id: string }>;
			assert.ok(nestedTerm, 'the nested terms were created under the contract');
			const nestedTermId = nestedTerm.id;

			// A committed Work date keeps term history sealed even after the source is removed.
			const workDay = await command({
				action: 'mutate',
				collection: 'work_days',
				rows: [
					{
						action: 'create',
						values: {
							employment_id: nestedContractId,
							work_date: '2026-08-03',
							worked_intervals: null
						}
					}
				]
			});
			requireAccepted(workDay.value);
			const [workId] = createdIds(workDay.value);
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
			// No seal log: once the only consumer is gone, the terms are editable again.
			requireAccepted(
				(await updateTerms({ residency_status: 'FOREIGNER' })).value,
				'terms edit after the consumer is removed'
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
			const successor = (start: string) => ({
				...nestedTerms,
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
