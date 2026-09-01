import { defineConfig, stringlyPack } from '@norbital-ai/doctor';

/**
 * Workspace health rules for this published template.
 *
 * This file ships with the template, so a tenant created from it in Colony is audited by the
 * same rules the template was. Add YAML extensions beside this file; they join automatically.
 */
// `reactivePack` moved into @norbital-ai/doctor-norbital, which is a product-repo dependency a
// shipped template does not carry; the named `norbital` pack and the stringly rules remain the
// template's contract.
export default defineConfig({ packs: ['norbital', stringlyPack] });
