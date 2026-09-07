import { group } from '@norbital-ai/bolt/authoring';

/**
 * The five request families, one page each.
 *
 * Apps are discovered from the files in this directory, so this group is the directory. It replaces
 * the single Component entries page, which listed one table holding claims, allowances, bonuses,
 * arrears and corrections at once and could therefore show none of their own facts: the columns it
 * could draw were the four every family shares, and each row's actual content — the day an expense
 * was incurred, the periods an arrears settlement makes good, the line a correction fixes — lived
 * inside a jsonb blob it printed as a summary string.
 *
 * It sits under `hr_controller` rather than beside it because that is what the ranks are granted.
 * `capabilities.apps` matches a name or a `<name>/` prefix, so every policy that already names
 * `hr_controller` reaches these five pages and none had to be edited to make them visible.
 *
 * Leave requests are the sixth family and belong here by the same argument. They are still served
 * from `hr_controller/leave`; moving that file is a rename of a page several suites address by
 * path, and is not part of this change.
 */
export default group({
	label: 'Events',
	description:
		'What a person raises against the pay catalogue, one page per family: claims to be reimbursed, standing allowances, bonuses awarded, arrears for periods already run, and corrections to lines that have already settled.',
	icon: 'lucide:inbox',
	defaultChild: 'claims'
});
