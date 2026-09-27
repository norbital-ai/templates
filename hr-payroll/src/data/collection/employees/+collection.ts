import { everyField } from '../../../lib/every-field.js';
import { collection, type Instant } from '@norbital-ai/bolt';
import { coversDate } from '../../../lib/payroll/run/effective.js';
import {
	KIOSK_EMBEDDING_DIMENSIONS,
	KIOSK_MATCH_MARGIN,
	KIOSK_MATCH_THRESHOLD
} from '../../../lib/kiosk/embed.js';
import { entityDay } from '../../../lib/kiosk/entity-day.js';
import { stableJson } from '../../../lib/jurisdiction_settings.js';
import { refuse } from '../../../lib/refuse.js';

/** A person, hired with their first contract in one write (the hire form and the kiosk enrolment). */
const employees = collection('employees', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'name',
				'date_of_birth',
				'gender',
				'marital_status',
				'solo_parent',
				'race',
				'religion',
				'spouse_status',
				'children',
				'nationality',
				'identity_number',
				'dependents_count',
				'disabled',
				'receiving_pension',
				'email',
				'phone',
				'address',
				'location',
				'user_id',
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_consent_at',
				'face_enrolled_at',
				'face_last_match_at',
				'face_match_count'
			],
			with: {
				employments: { create: { columns: ['company_id', 'employee_number', 'effective_range'] } }
			}
		}
	},
	update: {
		input: {
			columns: [
				'name',
				'date_of_birth',
				'gender',
				'marital_status',
				'solo_parent',
				'race',
				'religion',
				'spouse_status',
				'children',
				'nationality',
				'identity_number',
				'dependents_count',
				'disabled',
				'receiving_pension',
				'email',
				'phone',
				'address',
				'location',
				'user_id',
				'face_embedding',
				'face_photo',
				'face_enrollment_status',
				'face_consent_at',
				'face_enrolled_at',
				'face_last_match_at',
				'face_match_count'
			]
		}
	},
	delete: {},
	similarity: {
		face: {
			description: 'Approved kiosk faces nearest a face descriptor (cosine distance).',
			input: { probe: { kind: 'list', of: { kind: 'number' } } },
			candidates: 1
		}
	},
	queries: {
		kiosk_match: {
			description:
				'Identifies an approved face only when clearly separated from the runner-up, then resolves exactly one active employment contract in the explicitly selected entity.',
			input: {
				company_id: { kind: 'id', of: 'companies' },
				probe: { kind: 'list', of: { kind: 'number' } },
				threshold: { kind: 'number', min: 0, max: KIOSK_MATCH_THRESHOLD, optional: true }
			},
			output: { kind: 'json' }
		}
	},
	actions: {
		kiosk_enroll: {
			description:
				'Enrolls a kiosk face: attaches the descriptor to a known person (approved at once), or creates the person and their employment as PENDING for HR review. The kiosk policy — never this action — keeps APPROVED out of kiosk reach.',
			input: {
				employee_id: { kind: 'id', of: 'employees', optional: true },
				new_person: {
					kind: 'object',
					optional: true,
					fields: {
						name: { kind: 'text' },
						email: { kind: 'text', optional: true },
						phone: { kind: 'text', optional: true },
						company_id: { kind: 'id', of: 'companies' },
						employee_number: { kind: 'text', optional: true }
					}
				},
				face_embedding: { kind: 'list', of: { kind: 'number' } },
				face_photo: {
					kind: 'file',
					accept: ['image/jpeg', 'image/png'],
					max: '5MiB',
					optional: true
				},
				consent_at: { kind: 'instant' }
			},
			output: { kind: 'json' }
		}
	}
});
export default employees;

/**
 * The person. Child facts are append-only: close a wrong fact with its period and append the correction. `children`
 * defaults to `[]`. A kiosk enrolment creates the person and their first employment together; the stint's contract
 * number is the platform's sequence.
 */
employees.transform(async (inputs, { existing, refuse }) =>
	inputs.map((input, index) => {
		const stored = existing[index];
		if (stored == null) return input;
		const next = input.children;
		if (next != null) {
			const prior = stored.children;
			if (
				next.length < prior.length ||
				prior.some((row, at) => stableJson(row) !== stableJson(next[at]))
			)
				refuse(
					'Child facts are append-only. Close a wrong fact with its effective period and append the correction.',
					{ field: 'children' }
				);
		}
		return input;
	})
);

employees.similarity('face', {
	probe: ({ probe }) => ({
		field: 'face_embedding',
		vector: probe,
		// committed enrolments only, as today's nearest-neighbour read filtered them
		where: { face_enrollment_status: { eq: 'APPROVED' }, approval_id: { isNull: true } }
	})
});

/**
 * Identifies an approved face only when clearly separated from the runner-up, then resolves exactly one active
 * employment contract in the explicitly selected entity.
 */
employees.query('kiosk_match', async ({ company_id, probe, threshold }, ctx) => {
	if (probe.length !== KIOSK_EMBEDDING_DIMENSIONS)
		refuse(`Probe must hold ${KIOSK_EMBEDDING_DIMENSIONS} numbers, got ${probe.length}.`);
	if (probe.every((value) => value === 0)) refuse('Probe must contain a face descriptor.');
	const maximum = threshold ?? KIOSK_MATCH_THRESHOLD;
	// a named similarity answers the ranked rows themselves, not a page (§3.5; engine/query/engine.ts)
	const rows = await ctx.similar(
		'employees',
		'face',
		{ probe },
		{ limit: 2, select: { name: true } }
	);
	const [hit, next] = rows;
	const runnerUp =
		next != null && next.$distance <= maximum + KIOSK_MATCH_MARGIN ? next : undefined;
	if (
		hit === undefined ||
		!Number.isFinite(hit.$distance) ||
		hit.$distance > maximum ||
		(runnerUp !== undefined && runnerUp.$distance - hit.$distance < KIOSK_MATCH_MARGIN)
	)
		return { status: 'unknown' };
	const [employments, today] = await Promise.all([
		ctx.read('employments', {
			where: { employee_id: { eq: hit.id }, company_id: { eq: company_id } },
			select: { employee_number: true, company_id: true, effective_range: true },
			all: true
		}),
		entityDay(ctx, company_id)
	]);
	const active = employments.rows.filter((row) => coversDate(row.effective_range, today));
	if (active.length > 1)
		refuse(
			'This employee has overlapping active employment contracts in the selected entity. Resolve the contracts before recording attendance.'
		);
	const employee = { id: hit.id, name: hit.name };
	const current = active[0];
	if (current === undefined) return { status: 'unenrolled', employee, distance: hit.$distance };
	return {
		status: 'match',
		employee,
		employment: {
			id: current.id,
			employee_number: current.employee_number,
			company_id: current.company_id
		},
		distance: hit.$distance
	};
});

/**
 * Enrolls a kiosk face: a known person's descriptor is replaced and approved at once; a new person is created with
 * their employment as PENDING for HR. The caller's grants (the kiosk policy's `previous`) keep APPROVED out of kiosk
 * reach; this action only shapes the write.
 */
employees.action(
	'kiosk_enroll',
	async ({ employee_id, new_person, face_embedding, face_photo, consent_at }, ctx) => {
		if (face_embedding.length !== KIOSK_EMBEDDING_DIMENSIONS)
			ctx.refuse(
				`Embedding must hold ${KIOSK_EMBEDDING_DIMENSIONS} numbers, got ${face_embedding.length}.`
			);
		if (face_embedding.every((value) => value === 0))
			ctx.refuse('Embedding must contain a face descriptor.');
		if (String(consent_at) > String(ctx.now))
			ctx.refuse('Consent cannot be recorded in the future.');
		if (employee_id != null) {
			if (new_person != null) ctx.refuse('Pass an employee or a new person, not both.');
			const known = await ctx.get('employees', employee_id, { select: everyField('employees') });
			if (known == null) return ctx.refuse('Employee does not exist.');
			if (
				known.face_enrollment_status === 'PENDING' ||
				known.face_enrollment_status === 'SUSPENDED'
			)
				ctx.refuse(
					'HR must review this pending or suspended face enrollment before it can be replaced.'
				);
			await ctx.act('employees.update', {
				target: employee_id,
				set: {
					face_embedding,
					...(face_photo == null ? {} : { face_photo }),
					face_enrollment_status: 'APPROVED',
					face_consent_at: consent_at,
					face_enrolled_at: ctx.now
				}
			});
			return { employee_id, status: 'APPROVED' };
		}
		if (new_person == null) return ctx.refuse('Pass an employee or a new person.');
		const name = new_person.name.trim();
		if (name.length === 0) ctx.refuse('A new person needs a name.');
		const employeeNumber = new_person.employee_number?.trim() || `KIOSK-${crypto.randomUUID()}`;
		// `children` is omitted: its default fills it, and the kiosk grant does not admit it.
		const person = {
			name,
			email: new_person.email ?? null,
			phone: new_person.phone ?? null,
			face_embedding,
			face_photo: face_photo ?? null,
			face_enrollment_status: 'PENDING' as const,
			face_consent_at: consent_at,
			face_enrolled_at: ctx.now,
			employments: {
				create: [
					{
						company_id: new_person.company_id,
						employee_number: employeeNumber,
						effective_range: { from: ctx.today, to: null }
					}
				]
			}
		};
		const created = await ctx.act('employees.create', person);
		return {
			status: 'PENDING',
			employee_id: created.records.find((record) => record.collection === 'employees')?.id ?? null,
			company_id: new_person.company_id,
			employee_number: employeeNumber
		};
	}
);
