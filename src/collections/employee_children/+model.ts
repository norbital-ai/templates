import { custom, defineModel, enums, instant, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One child fact for one employment — the personal fact statutory leave that scales by children
 * computes against.
 *
 * Append-only: a correction appends a row superseding the prior one, never edits it, so a paid
 * run's entitlement is reconstructable from immutable facts as of its own date. The birth date is
 * immutable because the age cutoffs laws state (`under 7`, `under 18`) are computed from it, not
 * stored; the effective range carries the *legal* events (adoption, guardianship) that start and
 * end the relationship — birth itself needs no range.
 *
 * Deliberately distinct from `employees.dependents_count`, which is the tax-relief scalar the PCB
 * computation consumes: different laws, different definitions, and neither is derived from the
 * other.
 */
export default defineModel(
	{
		employment_id: uuid().notNull(),
		child_birthdate: instant({ precision: 'day' }).notNull(),
		relationship: enums(['CHILD', 'STEPCHILD', 'ADOPTED', 'LEGAL_WARD']).notNull(),
		/** The legal span the relationship holds; null for a birth-child (born → ongoing). */
		effective_range: custom('instant_range', { precision: 'day' }),
		/** The fact row this correction supersedes. Null on an original fact. */
		supersedes_id: uuid()
	},
	{
		description:
			'One child fact for one employment: birth date, relationship and legal span. Append-only — corrections supersede prior facts — and the personal fact statutory leave that scales by children computes against.',
		recordLabel: ['child_birthdate', 'relationship'],
		icon: 'lucide:baby',
		indexes: [
			{ columns: ['employment_id'] },
			{ columns: ['supersedes_id'], unique: true, where: '"supersedes_id" IS NOT NULL' }
		]
	}
);
