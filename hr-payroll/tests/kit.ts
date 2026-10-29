import { TestWorkspace, type TestOptions, type TestPorts } from '@norbital-ai/bolt-cli/test';

/** One scoped real workspace over this template's source, seeded by the rows a test writes. */
export const workspace = <P extends TestPorts = never>(
	options: Omit<
		Extract<TestOptions<P>, { artifact?: never }>,
		'root' | 'manifest' | 'guest' | 'transforms'
	> = {}
) => TestWorkspace.layer({ root: process.cwd(), ...options });
