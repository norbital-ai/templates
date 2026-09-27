import { relationship } from '@norbital-ai/bolt';

/** How the CRM joins. Every link is optional, as it was; nothing is deleted, so no delete rule is exercised. */
export default relationship({
	'contacts.company_id': { to: 'companies', inverse: 'company_contacts', optional: true },
	'projects.company_id': { to: 'companies', inverse: 'company_projects', optional: true },
	'projects.lead_contact_id': { to: 'contacts', inverse: 'led_projects', optional: true },
	'activities.project_id': { to: 'projects', inverse: 'project_activities', optional: true },
	'activities.contact_id': { to: 'contacts', inverse: 'contact_activities', optional: true },
	'issues.project_id': { to: 'projects', inverse: 'project_issues', optional: true },
	'issues.owner_id': { to: 'contacts', inverse: 'owned_issues', optional: true },
	'project_documents.project_id': { to: 'projects', inverse: 'project_documents', optional: true }
});
