import { team } from '@norbital-ai/bolt';

/**
 * Which policies each team holds; who is on a team is a row, bound here by name. The two desk policies are disjoint
 * peers, not a ladder: procurement has no `quotes` grant, so it never sees a sell price or a margin, and sales has no
 * `purchase_order_lines` grant, so it never sees a buy cost. `Sales & Procurement` is the one team that sees both,
 * and the one the seeded administrators hold.
 */
export default team({
	Sales: ['accounts_read', 'products_read', 'commercial_shared', 'sales_rep'],
	Procurement: ['products_read', 'suppliers_manage', 'commercial_shared', 'procurement_officer'],
	'Sales & Procurement': [
		'accounts_read',
		'products_read',
		'suppliers_manage',
		'commercial_shared',
		'sales_rep',
		'procurement_officer'
	]
});
