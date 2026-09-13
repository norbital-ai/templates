import type { Relationships } from './$types.js';

/**
 * How the CRM collections join. Scalar `r` is the relationships builder parameter; keep
 * scalar `uuid()` keys on models that are foreign keys.
 */
export default ((r) => ({
	companies: {
		company_contacts: r.many.contacts(),
		company_projects: r.many.projects()
	},
	contacts: {
		contact_company: r.one.companies({ from: r.contacts.company_id, to: r.companies.id }),
		contact_activities: r.many.activities()
	},
	projects: {
		project_company: r.one.companies({ from: r.projects.company_id, to: r.companies.id }),
		project_lead_contact: r.one.contacts({
			from: r.projects.lead_contact_id,
			to: r.contacts.id
		}),
		project_activities: r.many.activities(),
		project_issues: r.many.issues(),
		project_documents: r.many.project_documents()
	},
	activities: {
		activity_project: r.one.projects({ from: r.activities.project_id, to: r.projects.id }),
		activity_contact: r.one.contacts({ from: r.activities.contact_id, to: r.contacts.id })
	},
	issues: {
		issue_project: r.one.projects({ from: r.issues.project_id, to: r.projects.id }),
		issue_owner: r.one.contacts({ from: r.issues.owner_id, to: r.contacts.id })
	},
	project_documents: {
		project_document_project: r.one.projects({
			from: r.project_documents.project_id,
			to: r.projects.id
		})
	}
})) satisfies Relationships;
