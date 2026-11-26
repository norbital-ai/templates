/**
 * Realistic 6-Storey Singapore Commercial / Mixed-Use Tower IFC4 Generator with Exact Analytical Ground Truth.
 *
 * Generates a valid ISO-10303-21 IFC4 STEP file (`Marina Commercial Tower`, 24m × 18m footprint,
 * B1 Basement Plantroom → L01 Main Lobby → L02–L04 Commercial Offices → Roof Plant Deck) containing
 * real 3D extruded geometry (`IFCEXTRUDEDAREASOLID` + `IFCRELVOIDSELEMENT` openings) across EVERY
 * major building system:
 *   01 Substructure (bored piles, pad footings)
 *   02 Structural Frame (RC columns, beams, cored slabs, shear walls, steel rebar, stairs + flights)
 *   03 Envelope (unitised curtain wall + glass plates, insulated EPDM roof)
 *   04 Architectural (masonry walls with window cutouts, 1-HR fire partitions, doors incl. deliberate
 *      BCA Cl. 4.4.2 width violation & SCDF Cl. 3.9 missing FireRating violation, awning windows,
 *      suspended gypsum ceilings, balustrades)
 *   05 HVAC / ACMV (chillers, pumps, exhaust fans, multi-storey insulated DN100 CHW risers, legacy
 *      IFC2x3-style DN25 CHW branch runs + inline proxy spools via port topology, HVAC ducts, diffusers)
 *   06 Plumbing / Sanitary / Gas (DN32 CW mains, DN20 CW branches, DN100 sanitary DWV, DN25 gas pipes,
 *      sanitary fixtures, pipe fittings, isolation valves)
 *   07 Fire Protection (multi-storey DN100 wet risers, DN50 sprinkler mains, pendent sprinklers, smoke alarms)
 *   08 Electrical & ELV (LV switchboards, cable trays, EMT conduits, LSOH cables, downlights, sockets)
 *   09 Vertical Transport (gearless MRL passenger lifts)
 *   10 Real-world contractor quirks (federated duplicate beams, inline pipe proxy, standalone scaffold
 *      proxy bays, excluded IFCSPACE volumes)
 *
 * Simultaneously produces:
 * - Real triangulated `ElementMeasure` map matching the exact 3D solids (incl. cutouts/voids)
 * - Exact analytical `groundTruth` per Item Matrix code (net quantities + exact BigDecimal tender total)
 *   to prove < 1.0% cost estimation error rate end-to-end.
 */
import { BigDecimal } from 'effect';
import {
	measureElement,
	measureMesh,
	type ElementMeasure,
	type MeshMeasure
} from '../../src/services/bim/geometry.js';
import type { MatrixItem } from '../../src/services/bim/schema.js';
import { divSafe, moneyStr, toDecimal } from '../../src/services/commercial/decimal.js';

export type TowerGroundTruthItem = {
	readonly matrix_code: string;
	readonly unit: string;
	readonly quantity_basis: 'count' | 'length' | 'area' | 'volume' | 'weight' | 'derived';
	readonly expected_qty: number;
	readonly expected_amount: string;
};

export type ComplexTowerFixture = {
	readonly ifcText: string;
	readonly elementMeasures: ReadonlyMap<number, ElementMeasure>;
	readonly groundTruthByCode: ReadonlyMap<string, TowerGroundTruthItem>;
	readonly expectedDirectSubtotal: string;
	readonly expectedDerivedSubtotal: string;
	readonly expectedBimSubtotal: string;
	readonly expectedTotalWith5PctContingency: string;
	readonly expectedDuplicateCount: number;
	readonly expectedPromotedProxyCount: number;
	readonly expectedMultiStoreyRiserCount: number;
	readonly nonCompliantDoorExpressId: number;
	readonly missingFireRatingDoorExpressId: number;
	readonly totalPhysicalAssetsAfterDedup: number;
};

/** Full commercial main-contractor Item Matrix covering every building trade (36 items incl. derived rules). */
export const COMMERCIAL_TOWER_MATRIX: readonly MatrixItem[] = [
	{
		code: 'STR-PILE-BORED',
		name: 'Bored Cast-in-Situ RC Piles',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'piling',
		ifc_classes: ['IFCPILE'],
		match_keywords: ['pile', 'bored'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '580.00',
		waste_factor_pct: '5.0',
		carbon_factor: '360',
		active: true
	},
	{
		code: 'STR-FDN-PAD',
		name: 'RC Pad Footings',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'piling',
		ifc_classes: ['IFCFOOTING'],
		match_keywords: ['footing', 'pad'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '320.00',
		waste_factor_pct: '5.0',
		carbon_factor: '330',
		active: true
	},
	{
		code: 'STR-COL-RC300',
		name: 'RC Columns (Grade 40)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCCOLUMN'],
		match_keywords: ['column', 'concrete'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '520.00',
		waste_factor_pct: '4.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'STR-BEAM-RC400',
		name: 'RC Beams (Grade 40)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCBEAM'],
		match_keywords: ['beam', 'concrete'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '480.00',
		waste_factor_pct: '4.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'STR-SLAB-RC150',
		name: 'Suspended RC Floor Slabs',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCSLAB'],
		match_keywords: ['slab', 'concrete', 'floor'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '420.00',
		waste_factor_pct: '3.0',
		carbon_factor: '340',
		active: true
	},
	{
		code: 'STR-WALL-RC',
		name: 'RC Shear / Core Walls',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCWALL', 'IFCWALLSTANDARDCASE'],
		match_keywords: ['shear wall', 'core wall', 'rc', 'concrete'],
		unit: 'm3',
		quantity_basis: 'volume',
		currency: 'SGD',
		unit_rate: '460.00',
		waste_factor_pct: '3.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'STR-REBAR',
		name: 'High-Yield Steel Reinforcement',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCREINFORCINGBAR', 'IFCREINFORCINGMESH'],
		match_keywords: ['rebar', 'steel', 't20'],
		unit: 'kg',
		quantity_basis: 'weight',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	},
	{
		code: 'STR-STAIR-STEEL',
		name: 'Steel Stringer Staircase',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: ['IFCSTAIR', 'IFCSTAIRFLIGHT'],
		match_keywords: ['stair', 'stringer'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '3650.00',
		waste_factor_pct: '3.0',
		carbon_factor: '1250',
		active: true
	},
	{
		code: 'ARC-CW-GLAZED',
		name: 'Unitised Glazed Curtain Wall',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'facade',
		ifc_classes: ['IFCCURTAINWALL'],
		match_keywords: ['curtain wall', 'glazing', 'facade'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '850.00',
		waste_factor_pct: '3.0',
		carbon_factor: '180',
		active: true
	},
	{
		code: 'ARC-ROOF-EPDM',
		name: 'Insulated Flat Roof EPDM',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'roofing',
		ifc_classes: ['IFCROOF'],
		match_keywords: ['roof', 'epdm', 'membrane'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '125.00',
		waste_factor_pct: '4.0',
		carbon_factor: '40',
		active: true
	},
	{
		code: 'ARC-WALL-MSN150',
		name: '150mm Masonry Block Walls',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'structural',
		ifc_classes: ['IFCWALL', 'IFCWALLSTANDARDCASE'],
		match_keywords: ['masonry', '150mm', 'block'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '88.00',
		waste_factor_pct: '5.0',
		carbon_factor: '45',
		active: true
	},
	{
		code: 'ARC-WALL-PART1HR',
		name: '97mm 1-HR Fire-Rated Partitions',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCWALL', 'IFCWALLSTANDARDCASE'],
		match_keywords: ['partition', '1-hr', '97mm', 'fire'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '68.00',
		waste_factor_pct: '6.0',
		carbon_factor: '18',
		active: true
	},
	{
		code: 'ARC-DOOR-SGL-INT',
		name: 'Single Interior / Fire Timber Door',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'general',
		ifc_classes: ['IFCDOOR'],
		match_keywords: ['single', 'passage', 'flush', 'interior'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '980.00',
		waste_factor_pct: '2.0',
		carbon_factor: '45',
		active: true
	},
	{
		code: 'ARC-DOOR-DBL-GLASS',
		name: 'Double Full-Glass Entry Door',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'general',
		ifc_classes: ['IFCDOOR'],
		match_keywords: ['double', 'full glass', 'double_door'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '3450.00',
		waste_factor_pct: '2.0',
		carbon_factor: '160',
		active: true
	},
	{
		code: 'ARC-WIN-AWNING',
		name: 'Aluminium-Clad Awning Window',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'general',
		ifc_classes: ['IFCWINDOW'],
		match_keywords: ['awning', 'window'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '1180.00',
		waste_factor_pct: '3.0',
		carbon_factor: '140',
		active: true
	},
	{
		code: 'ARC-CEIL-GYP',
		name: 'Suspended Gypsum Board Ceilings',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'finishing',
		ifc_classes: ['IFCCOVERING'],
		match_keywords: ['ceiling', 'gypsum', 'plasterboard'],
		unit: 'm2',
		quantity_basis: 'area',
		currency: 'SGD',
		unit_rate: '55.00',
		waste_factor_pct: '5.0',
		carbon_factor: '8',
		active: true
	},
	{
		code: 'ARC-RAIL-BAL',
		name: 'Balustrade / Handrail',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'general',
		ifc_classes: ['IFCRAILING'],
		match_keywords: ['railing', 'handrail', 'glass panel'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '1350.00',
		waste_factor_pct: '3.0',
		carbon_factor: '210',
		active: true
	},
	{
		code: 'MEP-HVAC-CHILLER',
		name: 'Water-Cooled Centrifugal Chiller 500RT',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCCHILLER'],
		match_keywords: ['chiller', '500rt'],
		system_services: ['chilled_water'],
		topology_mode: 'discontiguous',
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '165000.00',
		waste_factor_pct: '0.0',
		carbon_factor: '8500',
		active: true
	},
	{
		code: 'MEP-MECH-PUMP',
		name: 'Chilled Water Circulator Pump',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'mne',
		ifc_classes: ['IFCPUMP', 'IFCFLOWMOVINGDEVICE'],
		match_keywords: ['pump', 'circulator'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '4800.00',
		waste_factor_pct: '0.0',
		carbon_factor: '180',
		active: true
	},
	{
		code: 'MEP-HVAC-FAN',
		name: 'Rooftop Exhaust Fan',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCFAN', 'IFCFLOWMOVINGDEVICE'],
		match_keywords: ['fan', 'exhaust', 'rooftop'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '6200.00',
		waste_factor_pct: '0.0',
		carbon_factor: '350',
		active: true
	},
	{
		code: 'MEP-MECH-PIPE',
		name: 'Insulated CHW Pipework (DN40-DN100)',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['chilled', 'hydronic'],
		system_services: ['chilled_water', 'hydronic_hvac'],
		min_size_mm: 35,
		max_size_mm: 120,
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '95.00',
		waste_factor_pct: '5.0',
		carbon_factor: '6',
		active: true
	},
	{
		code: 'MEP-MECH-PIPE-SM',
		name: 'Insulated CHW Pipework (<=DN32)',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['chilled', 'hydronic', '25mm'],
		system_services: ['chilled_water', 'hydronic_hvac'],
		min_size_mm: 0,
		max_size_mm: 34,
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '68.00',
		waste_factor_pct: '5.0',
		carbon_factor: '3.8',
		active: true
	},
	{
		code: 'MEP-HVAC-DUCT',
		name: 'Galvanised HVAC Ductwork',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCDUCTSEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['duct', 'hvac'],
		system_services: ['ventilation_duct'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '145.00',
		waste_factor_pct: '6.0',
		carbon_factor: '12',
		active: true
	},
	{
		code: 'MEP-HVAC-DIFFUSER',
		name: 'Supply / Return Air Diffuser',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'hvac',
		ifc_classes: ['IFCAIRTERMINAL'],
		match_keywords: ['diffuser', 'supply air'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '160.00',
		waste_factor_pct: '2.0',
		carbon_factor: '15',
		active: true
	},
	{
		code: 'MEP-PLB-PIPE',
		name: 'Domestic Water Pipework (DN25-DN50)',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['cold water', 'copper'],
		system_services: ['domestic_cold_water', 'domestic_hot_water'],
		min_size_mm: 21,
		max_size_mm: 65,
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '65.00',
		waste_factor_pct: '5.0',
		carbon_factor: '4',
		active: true
	},
	{
		code: 'MEP-PLB-PIPE-CW-SM',
		name: 'Domestic Water Branch (<=DN20)',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['cold water', '20mm', 'branch'],
		system_services: ['domestic_cold_water', 'domestic_hot_water'],
		min_size_mm: 0,
		max_size_mm: 20.5,
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '42.00',
		waste_factor_pct: '5.0',
		carbon_factor: '2.4',
		active: true
	},
	{
		code: 'MEP-PLB-PIPE-SAN',
		name: 'Sanitary DWV Pipework',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['sanitary', 'waste', 'dwv', 'upvc'],
		system_services: ['sanitary_dwv', 'storm_drain'],
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '48.00',
		waste_factor_pct: '6.0',
		carbon_factor: '3.1',
		active: true
	},
	{
		code: 'MEP-GAS-PIPE',
		name: 'Natural Gas Pipework',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'mne',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['natural gas', 'gas'],
		system_services: ['natural_gas'],
		insulated: 'uninsulated',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '115.00',
		waste_factor_pct: '4.0',
		carbon_factor: '7.5',
		active: true
	},
	{
		code: 'MEP-PLB-SANITARY',
		name: 'Commercial Sanitary Fixture',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'mne',
		ifc_classes: ['IFCSANITARYTERMINAL'],
		match_keywords: ['toilet', 'sanitary'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '1120.00',
		waste_factor_pct: '2.0',
		carbon_factor: '85',
		active: true
	},
	{
		code: 'MEP-PIPE-FIT',
		name: 'Pipe Fittings',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCPIPEFITTING'],
		match_keywords: ['elbow', 'tee', 'fitting'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '85.00',
		waste_factor_pct: '4.0',
		carbon_factor: '4',
		active: true
	},
	{
		code: 'MEP-PLB-VALVE',
		name: 'Isolation Ball Valve',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'plumbing',
		ifc_classes: ['IFCVALVE'],
		match_keywords: ['valve', 'isolation'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '540.00',
		waste_factor_pct: '2.0',
		carbon_factor: '12',
		active: true
	},
	{
		code: 'MEP-FIRE-PIPE',
		name: 'SCDF Fire Wet Riser & Sprinkler Pipework',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCPIPESEGMENT', 'IFCFLOWSEGMENT'],
		match_keywords: ['fire', 'sprinkler', 'wet riser'],
		system_services: ['fire_protection'],
		insulated: 'any',
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '82.00',
		waste_factor_pct: '5.0',
		carbon_factor: '6.8',
		active: true
	},
	{
		code: 'MEP-FIRE-SPRINKLER',
		name: 'Pendent Fire Sprinkler Head',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCFIRESUPPRESSIONTERMINAL'],
		match_keywords: ['sprinkler', 'fire'],
		system_services: ['fire_protection'],
		topology_mode: 'discontiguous',
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '95.00',
		waste_factor_pct: '3.0',
		carbon_factor: '3.2',
		active: true
	},
	{
		code: 'MEP-FIRE-ALARM',
		name: 'Addressable Smoke Detector',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'fire_protection',
		ifc_classes: ['IFCSENSOR', 'IFCALARM'],
		match_keywords: ['smoke detector', 'fire alarm'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '1650.00',
		waste_factor_pct: '2.0',
		carbon_factor: '40',
		active: true
	},
	{
		code: 'MEP-ELEC-PANEL',
		name: '400A LV Distribution Panelboard',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCELECTRICDISTRIBUTIONBOARD'],
		match_keywords: ['panelboard', 'switchboard', '400 a'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '18500.00',
		waste_factor_pct: '0.0',
		carbon_factor: '950',
		active: true
	},
	{
		code: 'MEP-ELEC-TRAY',
		name: 'HDG Cable Tray',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCCABLECARRIERSEGMENT'],
		match_keywords: ['cable tray', 'trunking', 'tray'],
		system_services: ['electrical_power'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '38.00',
		waste_factor_pct: '5.0',
		carbon_factor: '9',
		active: true
	},
	{
		code: 'MEP-ELEC-CONDUIT',
		name: 'EMT Electrical Conduit',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCCABLECARRIERSEGMENT'],
		match_keywords: ['conduit', 'emt'],
		system_services: ['electrical_power'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '18.00',
		waste_factor_pct: '5.0',
		carbon_factor: '2',
		active: true
	},
	{
		code: 'MEP-ELEC-CABLE',
		name: 'LSOH Power & Lighting Cable',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCCABLESEGMENT'],
		match_keywords: ['cable', 'lsoh'],
		system_services: ['electrical_power'],
		topology_mode: 'contiguous_linear',
		unit: 'm',
		quantity_basis: 'length',
		currency: 'SGD',
		unit_rate: '12.00',
		waste_factor_pct: '8.0',
		carbon_factor: '0.6',
		active: true
	},
	{
		code: 'MEP-ELEC-DOWNLIGHT',
		name: 'LED Recessed Downlight',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCLIGHTFIXTURE'],
		match_keywords: ['downlight', 'recessed', 'luminaire'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '120.00',
		waste_factor_pct: '2.0',
		carbon_factor: '12',
		active: true
	},
	{
		code: 'MEP-ELEC-OUTLET',
		name: 'Duplex Power Socket Outlet',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'electrical',
		ifc_classes: ['IFCOUTLET'],
		match_keywords: ['receptacle', 'outlet', 'switch'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '185.00',
		waste_factor_pct: '3.0',
		carbon_factor: '3',
		active: true
	},
	{
		code: 'MEP-LIFT-PASS',
		name: 'Gearless MRL Passenger Lift',
		category: 'bim_asset',
		discipline: 'mep',
		trade_specialty: 'mne',
		ifc_classes: ['IFCTRANSPORTELEMENT'],
		match_keywords: ['lift', 'elevator', 'passenger'],
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '145000.00',
		waste_factor_pct: '0.0',
		carbon_factor: '12500',
		active: true
	},
	{
		code: 'GEN-SCAFFOLD-BAY',
		name: 'Facade Scaffold Bay',
		category: 'bim_asset',
		discipline: 'general',
		trade_specialty: 'general',
		ifc_classes: ['IFCBUILDINGELEMENTPROXY'],
		match_keywords: ['scaffold', 'temporary works'],
		topology_mode: 'discontiguous',
		unit: 'ea',
		quantity_basis: 'count',
		currency: 'SGD',
		unit_rate: '420.00',
		waste_factor_pct: '0.0',
		carbon_factor: '35',
		active: true
	},
	// Derived items (automatically derived on storeys without modelled rebar, plus formwork & paint)
	{
		code: 'STR-REBAR-SLAB',
		name: 'Rebar to Slabs (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'kg',
		quantity_basis: 'derived',
		derived_from: 'STR-SLAB-RC150',
		ratio: '100',
		stands_in_for: 'STR-REBAR',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	},
	{
		code: 'STR-REBAR-BEAM',
		name: 'Rebar to Beams (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'kg',
		quantity_basis: 'derived',
		derived_from: 'STR-BEAM-RC400',
		ratio: '160',
		stands_in_for: 'STR-REBAR',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	},
	{
		code: 'STR-REBAR-COL',
		name: 'Rebar to Columns (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'kg',
		quantity_basis: 'derived',
		derived_from: 'STR-COL-RC300',
		ratio: '220',
		stands_in_for: 'STR-REBAR',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	},
	{
		code: 'STR-REBAR-WALL',
		name: 'Rebar to Walls (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'kg',
		quantity_basis: 'derived',
		derived_from: 'STR-WALL-RC',
		ratio: '90',
		stands_in_for: 'STR-REBAR',
		currency: 'SGD',
		unit_rate: '1.65',
		waste_factor_pct: '5.0',
		carbon_factor: '1.99',
		active: true
	},
	{
		code: 'STR-FORMWORK-SLAB',
		name: 'Slab Soffit Formwork (derived)',
		category: 'bim_asset',
		discipline: 'structural',
		trade_specialty: 'structural',
		ifc_classes: [],
		match_keywords: [],
		unit: 'm2',
		quantity_basis: 'derived',
		derived_from: 'STR-SLAB-RC150',
		ratio: '5',
		currency: 'SGD',
		unit_rate: '38.00',
		waste_factor_pct: '0.0',
		carbon_factor: '6',
		active: true
	},
	{
		code: 'ARC-PAINT-PARTITION',
		name: 'Emulsion Paint to Partitions (derived)',
		category: 'bim_asset',
		discipline: 'architecture',
		trade_specialty: 'finishing',
		ifc_classes: [],
		match_keywords: [],
		unit: 'm2',
		quantity_basis: 'derived',
		derived_from: 'ARC-WALL-PART1HR',
		ratio: '2',
		currency: 'SGD',
		unit_rate: '6.50',
		waste_factor_pct: '5.0',
		carbon_factor: '0.6',
		active: true
	}
];

/** Axis-aligned 3D box mesh (12 triangles) for exact analytical geometry measurement. */
function boxMesh(dx: number, dy: number, dz: number): MeshMeasure {
	const corners = [
		[0, 0, 0],
		[dx, 0, 0],
		[dx, dy, 0],
		[0, dy, 0],
		[0, 0, dz],
		[dx, 0, dz],
		[dx, dy, dz],
		[0, dy, dz]
	];
	const faces = [
		[0, 2, 1, 0, 3, 2],
		[4, 5, 6, 4, 6, 7],
		[0, 1, 5, 0, 5, 4],
		[2, 3, 7, 2, 7, 6],
		[1, 2, 6, 1, 6, 5],
		[0, 4, 7, 0, 7, 3]
	].flat();
	const m = measureMesh(
		new Float32Array(corners.flatMap((c) => [...c, 0, 0, 0])),
		new Uint32Array(faces)
	);
	if (m === null) throw new Error('Invalid box mesh');
	return m;
}

function shiftedBoxPart(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
	return {
		mesh: boxMesh(dx, dy, dz),
		transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ox, oy, oz, 1]
	};
}

function makeBoxMeasure(
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number
): ElementMeasure {
	const m = measureElement([shiftedBoxPart(ox, oy, oz, dx, dy, dz)]);
	if (m === null) throw new Error('Failed to measure box');
	return m;
}

function mustMeasure(
	parts: readonly { readonly mesh: MeshMeasure; readonly transform: readonly number[] }[]
): ElementMeasure {
	const m = measureElement(parts);
	if (m === null) throw new Error('Failed to measure compound element');
	return m;
}

/** Measures a cylinder (pipe/pile) using a 16-gon prism along X, Y, or Z so volume/extents are <0.5% exact. */
function makeCylinderMeasure(
	ox: number,
	oy: number,
	oz: number,
	diameter: number,
	length: number,
	axis: 'x' | 'y' | 'z'
): ElementMeasure {
	const segs = 48;
	const r = diameter / 2;
	const verts: number[] = [];
	const indices: number[] = [];
	const pushVert = (x: number, y: number, z: number) => {
		verts.push(x, y, z, 0, 0, 0);
	};
	const mapPt = (u: number, v: number, w: number): [number, number, number] => {
		if (axis === 'x') return [ox + w, oy + u, oz + v];
		if (axis === 'y') return [ox + u, oy + w, oz + v];
		return [ox + u, oy + v, oz + w];
	};
	// Center vertices 0 (bottom) and 1 (top)
	pushVert(...mapPt(0, 0, 0));
	pushVert(...mapPt(0, 0, length));
	for (let i = 0; i < segs; i++) {
		const a = (i / segs) * Math.PI * 2;
		const cu = Math.cos(a) * r;
		const cv = Math.sin(a) * r;
		pushVert(...mapPt(cu, cv, 0));
		pushVert(...mapPt(cu, cv, length));
	}
	for (let i = 0; i < segs; i++) {
		const next = (i + 1) % segs;
		const b0 = 2 + i * 2;
		const t0 = b0 + 1;
		const b1 = 2 + next * 2;
		const t1 = b1 + 1;
		// Bottom cap (winding outward)
		indices.push(0, b1, b0);
		// Top cap
		indices.push(1, t0, t1);
		// Side quad
		indices.push(b0, b1, t1, b0, t1, t0);
	}
	const mesh = measureMesh(new Float32Array(verts), new Uint32Array(indices));
	if (mesh === null) throw new Error('Invalid cylinder mesh');
	const m = measureElement([{ mesh, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]);
	if (m === null) throw new Error('Failed to measure cylinder');
	return m;
}

/**
 * Generates the complete 6-storey commercial tower IFC4 STEP model, exact 3D element measures,
 * and exact analytical ground-truth quantities and cost totals against the provided Item Matrix.
 */
export function buildComplexCommercialTowerIfc4(
	matrix: readonly MatrixItem[]
): ComplexTowerFixture {
	const lines: string[] = [];
	const measures = new Map<number, ElementMeasure>();
	let nextId = 1;
	let guidSeq = 1;

	const id = () => nextId++;
	const guid = () => `2MCTower${String(guidSeq++).padStart(14, '0')}`;
	const emit = (stmt: string): number => {
		const eid = id();
		lines.push(`#${eid}= ${stmt};`);
		return eid;
	};
	const esc = (s: string) => s.replace(/'/g, "''");

	// Shared IFC4 boilerplate
	const ownerHist = emit(`IFCOWNERHISTORY(#2,#3,$,.NOCHANGE.,$,$,$,1767225600)`);
	const person = emit(`IFCPERSONANDORGANIZATION(#4,#5,$)`);
	const app = emit(`IFCAPPLICATION(#5,'2026.1','Norbital BIM Generator','NBIM')`);
	emit(`IFCPERSON($,'Lead','Coordinator',$,$,$,$,$)`);
	emit(`IFCORGANIZATION($,'Norbital Engineering',$,$,$)`);
	void person;
	void app;

	// Units: METRE, SQUARE_METRE, CUBIC_METRE, KILOGRAM
	const uLen = emit(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
	const uArea = emit(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
	const uVol = emit(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
	const uMass = emit(`IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.)`);
	const uAssign = emit(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol},#${uMass}))`);

	const originPt = emit(`IFCCARTESIANPOINT((0.,0.,0.))`);
	const dirZ = emit(`IFCDIRECTION((0.,0.,1.))`);
	const dirX = emit(`IFCDIRECTION((1.,0.,0.))`);
	const dirY = emit(`IFCDIRECTION((0.,1.,0.))`);
	const worldAx = emit(`IFCAXIS2PLACEMENT3D(#${originPt},#${dirZ},#${dirX})`);
	const ctx3d = emit(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldAx},$)`);

	const project = emit(
		`IFCPROJECT('${guid()}',#${ownerHist},'MCT-002','6-Storey Commercial & Mixed-Use Tower',$,'Marina Commercial Tower',$,(#${ctx3d}),#${uAssign})`
	);
	const sitePl = emit(`IFCLOCALPLACEMENT($,#${worldAx})`);
	const site = emit(
		`IFCSITE('${guid()}',#${ownerHist},'Site',$,$,#${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`
	);
	const bldgPl = emit(`IFCLOCALPLACEMENT(#${sitePl},#${worldAx})`);
	const bldg = emit(
		`IFCBUILDING('${guid()}',#${ownerHist},'Marina Commercial Tower',$,$,#${bldgPl},$,$,.ELEMENT.,$,$,$)`
	);
	emit(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${project},(#${site}))`);
	emit(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${site},(#${bldg}))`);

	// Storeys
	const storeySpecs = [
		{ key: 'B1', name: 'B1 - Basement Plantroom', elev: -4.2, height: 4.2 },
		{ key: 'L01', name: 'L01 - Main Lobby', elev: 0.0, height: 4.5 },
		{ key: 'L02', name: 'L02 - Office', elev: 4.5, height: 4.0 },
		{ key: 'L03', name: 'L03 - Office', elev: 8.5, height: 4.0 },
		{ key: 'L04', name: 'L04 - Office', elev: 12.5, height: 4.0 },
		{ key: 'ROOF', name: 'Roof - Plant Deck', elev: 16.5, height: 3.5 }
	] as const;

	const storeyIds = new Map<string, number>();
	const storeyPlIds = new Map<string, number>();
	const storeyMembers = new Map<string, number[]>();
	for (const st of storeySpecs) {
		const pt = emit(`IFCCARTESIANPOINT((0.,0.,${st.elev.toFixed(3)}))`);
		const ax = emit(`IFCAXIS2PLACEMENT3D(#${pt},#${dirZ},#${dirX})`);
		const pl = emit(`IFCLOCALPLACEMENT(#${bldgPl},#${ax})`);
		const sid = emit(
			`IFCBUILDINGSTOREY('${guid()}',#${ownerHist},'${esc(st.name)}',$,$,#${pl},$,'${esc(st.name)}',.ELEMENT.,${st.elev.toFixed(3)})`
		);
		storeyIds.set(st.key, sid);
		storeyPlIds.set(st.key, pl);
		storeyMembers.set(st.key, []);
	}
	emit(
		`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${bldg},(${storeySpecs.map((s) => `#${storeyIds.get(s.key)}`).join(',')}))`
	);

	// Shared materials
	const matCache = new Map<string, number>();
	const mat = (name: string): number => {
		const existing = matCache.get(name);
		if (existing !== undefined) return existing;
		const mid = emit(`IFCMATERIAL('${esc(name)}')`);
		matCache.set(name, mid);
		return mid;
	};
	const assignMat = (elemIds: number[], matName: string, layerThicknessM?: number) => {
		if (elemIds.length === 0) return;
		const mid = mat(matName);
		let targetMat = mid;
		if (layerThicknessM !== undefined) {
			const lyr = emit(
				`IFCMATERIALLAYER(#${mid},${layerThicknessM.toFixed(4)},$,'${esc(matName)}',$,$,$)`
			);
			targetMat = emit(`IFCMATERIALLAYERSET((#${lyr}),'${esc(matName)}')`);
		}
		emit(
			`IFCRELASSOCIATESMATERIAL('${guid()}',#${ownerHist},$,$,(${elemIds.map((e) => `#${e}`).join(',')}),#${targetMat})`
		);
	};

	// Geometry helpers for IFC4 3D viewer representation
	const rect2dAx = emit(`IFCAXIS2PLACEMENT2D(#${emit(`IFCCARTESIANPOINT((0.,0.))`)},$)`);
	const placeAt = (
		storeyKey: string,
		x: number,
		y: number,
		zRel: number,
		dirAxis?: number,
		refAxis?: number
	): number => {
		const pt = emit(`IFCCARTESIANPOINT((${x.toFixed(4)},${y.toFixed(4)},${zRel.toFixed(4)}))`);
		const ax = emit(`IFCAXIS2PLACEMENT3D(#${pt},#${dirAxis ?? dirZ},#${refAxis ?? dirX})`);
		return emit(`IFCLOCALPLACEMENT(#${storeyPlIds.get(storeyKey)},#${ax})`);
	};
	const boxShape = (dx: number, dy: number, dz: number): number => {
		const prof = emit(
			`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${rect2dAx},${dx.toFixed(4)},${dy.toFixed(4)})`
		);
		const solid = emit(`IFCEXTRUDEDAREASOLID(#${prof},#${worldAx},#${dirZ},${dz.toFixed(4)})`);
		const rep = emit(`IFCSHAPEREPRESENTATION(#${ctx3d},'Body','SweptSolid',(#${solid}))`);
		return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
	};
	const cylShape = (diameter: number, length: number): number => {
		const prof = emit(`IFCCIRCLEPROFILEDEF(.AREA.,$,#${rect2dAx},${(diameter / 2).toFixed(4)})`);
		const solid = emit(`IFCEXTRUDEDAREASOLID(#${prof},#${worldAx},#${dirZ},${length.toFixed(4)})`);
		const rep = emit(`IFCSHAPEREPRESENTATION(#${ctx3d},'Body','SweptSolid',(#${solid}))`);
		return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
	};

	const addToStorey = (storeyKey: string, eid: number) => {
		storeyMembers.get(storeyKey)?.push(eid);
	};

	const addPset = (
		elemIds: number[],
		psetName: string,
		props: readonly (readonly [string, string, 'text' | 'length' | 'bool'])[]
	) => {
		if (elemIds.length === 0) return;
		const pids: number[] = [];
		for (const [k, v, kind] of props) {
			const valExpr =
				kind === 'length'
					? `IFCLENGTHMEASURE(${v})`
					: kind === 'bool'
						? `IFCBOOLEAN(${v === 'true' ? '.T.' : '.F.'})`
						: `IFCTEXT('${esc(v)}')`;
			pids.push(emit(`IFCPROPERTYSINGLEVALUE('${esc(k)}',$,${valExpr},$)`));
		}
		const ps = emit(
			`IFCPROPERTYSET('${guid()}',#${ownerHist},'${esc(psetName)}',$,(${pids.map((p) => `#${p}`).join(',')}))`
		);
		emit(
			`IFCRELDEFINESBYPROPERTIES('${guid()}',#${ownerHist},$,$,(${elemIds.map((e) => `#${e}`).join(',')}),#${ps})`
		);
	};

	const addQty = (
		elemIds: number[],
		qtoName: string,
		entries: readonly (readonly ['length' | 'area' | 'volume' | 'weight', string, number])[]
	) => {
		if (elemIds.length === 0) return;
		const qids: number[] = [];
		for (const [kind, name, val] of entries) {
			const ent =
				kind === 'length'
					? 'IFCQUANTITYLENGTH'
					: kind === 'area'
						? 'IFCQUANTITYAREA'
						: kind === 'volume'
							? 'IFCQUANTITYVOLUME'
							: 'IFCQUANTITYWEIGHT';
			qids.push(emit(`${ent}('${esc(name)}',$,$,${val.toFixed(6)})`));
		}
		const eq = emit(
			`IFCELEMENTQUANTITY('${guid()}',#${ownerHist},'${esc(qtoName)}',$,$,(${qids.map((q) => `#${q}`).join(',')}))`
		);
		emit(
			`IFCRELDEFINESBYPROPERTIES('${guid()}',#${ownerHist},$,$,(${elemIds.map((e) => `#${e}`).join(',')}),#${eq})`
		);
	};

	// Exact analytical ground truth accumulators by matrix code (and per storey for derived rebar rules!)
	const gtQty = new Map<string, number>();
	const gtStoreyQty = new Map<string, Map<string, number>>();
	const recordGt = (code: string, storeyKey: string, qty: number) => {
		gtQty.set(code, (gtQty.get(code) ?? 0) + qty);
		const stName = storeySpecs.find((s) => s.key === storeyKey)?.name ?? storeyKey;
		let sm = gtStoreyQty.get(stName);
		if (sm === undefined) {
			sm = new Map<string, number>();
			gtStoreyQty.set(stName, sm);
		}
		sm.set(code, (sm.get(code) ?? 0) + qty);
	};

	// Grid coordinates: X = [0, 8, 16, 24], Y = [0, 6, 12, 18] (4×3 perimeter + interior = 12 structural columns)
	const gridX = [0.25, 8.0, 16.0, 23.75];
	const gridY = [0.25, 9.0, 17.75];

	// ── 01 SUBSTRUCTURE: 12 Bored Piles + 12 RC Pad Footings (B1) ──
	const pileIds: number[] = [];
	const footingIds: number[] = [];
	const pileDiam = 0.8;
	const pileLen = 12.0;
	const pileVolExact = Math.PI * (pileDiam / 2) * (pileDiam / 2) * pileLen;
	const footVolExact = 2.4 * 2.4 * 0.8;

	for (const gx of gridX) {
		for (const gy of gridY) {
			// Pile underneath footing: z = -17.0 to -5.0
			const pPl = placeAt('B1', gx, gy, -12.8);
			const pSh = cylShape(pileDiam, pileLen);
			const pId = emit(
				`IFCPILE('${guid()}',#${ownerHist},'Bored RC Pile 800mm',$,'Bored Pile 800mm',#${pPl},#${pSh},'PL',.BORED.,$)`
			);
			pileIds.push(pId);
			addToStorey('B1', pId);
			measures.set(pId, makeCylinderMeasure(gx, gy, -17.0, pileDiam, pileLen, 'z'));
			recordGt('STR-PILE-BORED', 'B1', pileVolExact);

			// Pad Footing: 2.4 × 2.4 × 0.8m at z = -5.0 to -4.2
			const fPl = placeAt('B1', gx, gy, -0.8);
			const fSh = boxShape(2.4, 2.4, 0.8);
			const fId = emit(
				`IFCFOOTING('${guid()}',#${ownerHist},'RC Pad Footing 2400x2400x800',$,'Pad Footing G40',#${fPl},#${fSh},'FT',.PAD_FOOTING.)`
			);
			footingIds.push(fId);
			addToStorey('B1', fId);
			measures.set(fId, makeBoxMeasure(gx - 1.2, gy - 1.2, -5.0, 2.4, 2.4, 0.8));
			recordGt('STR-FDN-PAD', 'B1', footVolExact);
		}
	}
	assignMat(pileIds, 'Concrete Grade 40');
	assignMat(footingIds, 'Concrete Grade 40');

	// ── 02 STRUCTURAL FRAME: Columns, Beams, Cored RC Slabs, RC Core Walls, Rebar, Stairs ──
	const colIds: number[] = [];
	const beamIds: number[] = [];
	const slabIds: number[] = [];
	const coreWallIds: number[] = [];
	const rebarIds: number[] = [];
	const stairIds: number[] = [];

	const structLevels = storeySpecs.slice(0, 5); // B1, L01, L02, L03, L04
	for (const st of structLevels) {
		// 12 RC Columns per level (0.5 × 0.5 × st.height)
		for (const gx of gridX) {
			for (const gy of gridY) {
				const pl = placeAt(st.key, gx, gy, 0);
				const sh = boxShape(0.5, 0.5, st.height);
				const cid = emit(
					`IFCCOLUMN('${guid()}',#${ownerHist},'RC Column 500x500 G40',$,'Column Concrete 300 x 300',#${pl},#${sh},'CL',.COLUMN.)`
				);
				colIds.push(cid);
				addToStorey(st.key, cid);
				measures.set(cid, makeBoxMeasure(gx - 0.25, gy - 0.25, st.elev, 0.5, 0.5, st.height));
				recordGt('STR-COL-RC300', st.key, 0.5 * 0.5 * st.height);
			}
		}

		// 12 RC Beams per level (9 along X spans of 7.5m + 3 along Y spans of 8.5m, section 0.4 × 0.65m)
		const beamZ = st.height - 0.65;
		for (const gy of gridY) {
			for (let xi = 0; xi < 3; xi++) {
				const bx = gridX[xi] ?? 0;
				const spanX = (gridX[xi + 1] ?? 8) - bx - 0.5;
				const cx = bx + 0.25 + spanX / 2;
				const pl = placeAt(st.key, cx, gy, beamZ);
				const sh = boxShape(spanX, 0.4, 0.65);
				const bid = emit(
					`IFCBEAM('${guid()}',#${ownerHist},'RC Primary Beam 400x650 G40',$,'Beam Concrete 400 x 800',#${pl},#${sh},'BM',.BEAM.)`
				);
				beamIds.push(bid);
				addToStorey(st.key, bid);
				measures.set(bid, makeBoxMeasure(bx + 0.25, gy - 0.2, st.elev + beamZ, spanX, 0.4, 0.65));
				recordGt('STR-BEAM-RC400', st.key, spanX * 0.4 * 0.65);
			}
		}
		for (const gx of gridX) {
			const spanY = 8.25;
			const pl = placeAt(st.key, gx, 4.625, beamZ);
			const sh = boxShape(0.4, spanY, 0.65);
			const bid = emit(
				`IFCBEAM('${guid()}',#${ownerHist},'RC Secondary Beam 400x650 G40',$,'Beam Concrete 400 x 800',#${pl},#${sh},'BM',.BEAM.)`
			);
			beamIds.push(bid);
			addToStorey(st.key, bid);
			measures.set(bid, makeBoxMeasure(gx - 0.2, 0.5, st.elev + beamZ, 0.4, spanY, 0.65));
			recordGt('STR-BEAM-RC400', st.key, 0.4 * spanY * 0.65);
		}

		// 4 RC Core Shear Walls per level around lift/stair core (x=[9,15], y=[7,11], 0.25m thick)
		const coreDefs = [
			{ ox: 9.0, oy: 7.0, dx: 6.0, dy: 0.25 },
			{ ox: 9.0, oy: 10.75, dx: 6.0, dy: 0.25 },
			{ ox: 9.0, oy: 7.25, dx: 0.25, dy: 3.5 },
			{ ox: 14.75, oy: 7.25, dx: 0.25, dy: 3.5 }
		];
		for (const cw of coreDefs) {
			const pl = placeAt(st.key, cw.ox + cw.dx / 2, cw.oy + cw.dy / 2, 0);
			const sh = boxShape(cw.dx, cw.dy, st.height);
			const wid = emit(
				`IFCWALL('${guid()}',#${ownerHist},'RC Core Shear Wall 250mm G40',$,'Shear Wall RC Concrete',#${pl},#${sh},'CW',.SHEAR.)`
			);
			coreWallIds.push(wid);
			addToStorey(st.key, wid);
			measures.set(wid, makeBoxMeasure(cw.ox, cw.oy, st.elev, cw.dx, cw.dy, st.height));
			recordGt('STR-WALL-RC', st.key, cw.dx * cw.dy * st.height);
		}

		// 1 Prefabricated Staircase assembly per level (with 2 nested IFCSTAIRFLIGHT parts via IFCRELAGGREGATES)
		const stPl = placeAt(st.key, 10.5, 9.0, 0);
		const stairId = emit(
			`IFCSTAIR('${guid()}',#${ownerHist},'Steel Stringer Staircase',$,'Stair Metal Stringer',#${stPl},$,'ST',.HALF_TURN_STAIR.)`
		);
		const fl1 = emit(
			`IFCSTAIRFLIGHT('${guid()}',#${ownerHist},'Stair Flight Lower',$,'Stair',#${placeAt(st.key, 10.0, 8.2, 0)},#${boxShape(2.4, 1.2, st.height / 2)},'FL1',10,10,0.18,0.28,.STRAIGHT.)`
		);
		const fl2 = emit(
			`IFCSTAIRFLIGHT('${guid()}',#${ownerHist},'Stair Flight Upper',$,'Stair',#${placeAt(st.key, 10.0, 9.6, st.height / 2)},#${boxShape(2.4, 1.2, st.height / 2)},'FL2',10,10,0.18,0.28,.STRAIGHT.)`
		);
		emit(`IFCRELAGGREGATES('${guid()}',#${ownerHist},$,$,#${stairId},(#${fl1},#${fl2}))`);
		stairIds.push(stairId);
		addToStorey(st.key, stairId);
		measures.set(
			stairId,
			mustMeasure([
				shiftedBoxPart(9.0, 7.6, st.elev, 2.4, 1.2, st.height / 2),
				shiftedBoxPart(9.0, 9.0, st.elev + st.height / 2, 2.4, 1.2, st.height / 2)
			])
		);
		recordGt('STR-STAIR-STEEL', st.key, 1);
	}

	// 2 Federated Duplicate RC Beams on L01 & L02 (same exact position & size as architectural ghost copies!)
	// Must be automatically dropped by dropDuplicates so they contribute 0 to cost!
	const [gx0 = 0.25, gx1 = 8.0, gx2 = 16.0] = gridX;
	const [gy0 = 0.25, gy1 = 9.0] = gridY;
	const dupBeam1Span = gx1 - gx0 - 0.5;
	const dupBeam1Pl = placeAt('L01', gx0 + 0.25 + dupBeam1Span / 2, gy0, 4.5 - 0.65);
	const dupBeam1 = emit(
		`IFCBEAM('${guid()}',#${ownerHist},'Arch Copy Primary Beam 400x650',$,'Beam Concrete 400 x 800',#${dupBeam1Pl},#${boxShape(dupBeam1Span, 0.4, 0.65)},'BM-DUP1',.BEAM.)`
	);
	addToStorey('L01', dupBeam1);
	measures.set(
		dupBeam1,
		makeBoxMeasure(gx0 + 0.25 + 0.005, gy0 - 0.2, 0.0 + 4.5 - 0.65, dupBeam1Span, 0.4, 0.65)
	);

	const dupBeam2Span = gx2 - gx1 - 0.5;
	const dupBeam2Pl = placeAt('L02', gx1 + 0.25 + dupBeam2Span / 2, gy1, 4.0 - 0.65);
	const dupBeam2 = emit(
		`IFCBEAM('${guid()}',#${ownerHist},'Arch Copy Primary Beam 400x650',$,'Beam Concrete 400 x 800',#${dupBeam2Pl},#${boxShape(dupBeam2Span, 0.4, 0.65)},'BM-DUP2',.BEAM.)`
	);
	addToStorey('L02', dupBeam2);
	measures.set(
		dupBeam2,
		makeBoxMeasure(gx1 + 0.25 - 0.004, gy1 - 0.2, 4.5 + 4.0 - 0.65, dupBeam2Span, 0.4, 0.65)
	);

	// 6 Suspended RC Floor Slabs (all 6 storeys, 24m × 18m × 0.20m thick with 6m × 4m lift/stair core cutout!)
	// Net area = 24*18 - 6*4 = 432 - 24 = 408 m²; exact net volume = 408 * 0.20 = 81.6 m³ (naive bbox would be 86.4 m³ = +5.9% error!)
	for (const st of storeySpecs) {
		const sPl = placeAt(st.key, 12.0, 9.0, 0);
		const sSh = boxShape(24.0, 18.0, 0.2);
		const slabId = emit(
			`IFCSLAB('${guid()}',#${ownerHist},'Suspended RC Slab 200mm G40',$,'Concrete 150 Floor Slab',#${sPl},#${sSh},'SL',.FLOOR.)`
		);
		// Explicit IFC4 opening void for lift/stair shaft cutout (6m × 4m)
		const opPl = placeAt(st.key, 12.0, 9.0, -0.05);
		const opId = emit(
			`IFCOPENINGELEMENT('${guid()}',#${ownerHist},'Core Shaft Cutout 6x4m',$,'Opening',#${opPl},#${boxShape(6.0, 4.0, 0.3)},'OP',.OPENING.)`
		);
		emit(`IFCRELVOIDSELEMENT('${guid()}',#${ownerHist},$,$,#${slabId},#${opId})`);
		slabIds.push(slabId);
		addToStorey(st.key, slabId);
		// Real triangulated geometry of slab with 6×4 core hole (4 exact non-overlapping rectangular strips)
		const mSlab = measureElement([
			shiftedBoxPart(0, 0, st.elev, 24.0, 7.0, 0.2), // South wing: 168 m²
			shiftedBoxPart(0, 11.0, st.elev, 24.0, 7.0, 0.2), // North wing: 168 m²
			shiftedBoxPart(0, 7.0, st.elev, 9.0, 4.0, 0.2), // West strip: 36 m²
			shiftedBoxPart(15.0, 7.0, st.elev, 9.0, 4.0, 0.2) // East strip: 36 m²
		]);
		if (mSlab === null) throw new Error('Slab measure failed');
		measures.set(slabId, mSlab);
		recordGt('STR-SLAB-RC150', st.key, 408.0 * 0.2);
	}
	assignMat(colIds, 'Concrete Grade 40');
	assignMat([...beamIds, dupBeam1, dupBeam2], 'Concrete Grade 40');
	assignMat(slabIds, 'Concrete Grade 40', 0.2);
	assignMat(coreWallIds, 'Concrete Grade 40', 0.25);

	// Modelled Steel Rebar on B1 & L01 only (30 bars per floor, T20 × 8.0m = exact steel volume × 7850 kg/m³)
	// L02–ROOF omit modelled rebar so derived rules (STR-REBAR-SLAB/BEAM/COL/WALL) kick in cleanly!
	for (const stKey of ['B1', 'L01'] as const) {
		const elev = storeySpecs.find((s) => s.key === stKey)?.elev ?? 0;
		for (let i = 0; i < 30; i++) {
			const rx = 1.0 + (i % 6) * 3.5;
			const ry = 1.5 + Math.floor(i / 6) * 3.0;
			const pl = placeAt(stKey, rx, ry, 0.1, dirX, dirZ);
			const sh = cylShape(0.02, 8.0);
			const rid = emit(
				`IFCREINFORCINGBAR('${guid()}',#${ownerHist},'High-Yield Rebar T20',$,'Rebar T20 Steel',#${pl},#${sh},'RB',$,0.02,0.000314,8.0,.MAIN.,$)`
			);
			rebarIds.push(rid);
			addToStorey(stKey, rid);
			// Exact 20mm × 20mm × 8m bar or cylinder: use cylinder measure matching geometry weight = vol * 7850
			const cylM = makeCylinderMeasure(rx, ry, elev + 0.1, 0.02, 8.0, 'x');
			measures.set(rid, cylM);
			recordGt('STR-REBAR', stKey, Math.PI * 0.01 * 0.01 * 8.0 * 7850);
		}
	}
	assignMat(rebarIds, 'High-Yield Steel Grade 500B');

	// ── 03 FACADE & ROOFING: Curtain Walls (L01–L04) + Flat Roof EPDM (ROOF) ──
	const cwIds: number[] = [];
	for (const st of storeySpecs.slice(1, 5)) {
		// North & South facades: 24m × height (each split into 2 panels = 12m × height)
		for (const [ox, oy] of [
			[0, 0],
			[12, 0],
			[0, 17.85],
			[12, 17.85]
		] as const) {
			const pl = placeAt(st.key, ox + 6, oy + 0.075, 0);
			const sh = boxShape(12.0, 0.15, st.height);
			const cwid = emit(
				`IFCCURTAINWALL('${guid()}',#${ownerHist},'Unitised Glazed Curtain Wall',$,'Curtain Wall Glazing Facade',#${pl},#${sh},'CW',.NOTDEFINED.)`
			);
			cwIds.push(cwid);
			addToStorey(st.key, cwid);
			measures.set(cwid, makeBoxMeasure(ox, oy, st.elev, 12.0, 0.15, st.height));
			recordGt('ARC-CW-GLAZED', st.key, 12.0 * st.height);
		}
	}
	assignMat(cwIds, 'Double Glazed Aluminium Curtain Wall');

	// Flat Roof EPDM Waterproofing Deck on ROOF (24m × 18m minus 6m × 4m core = 408 m²)
	const roofPl = placeAt('ROOF', 12.0, 9.0, 0.2);
	const roofId = emit(
		`IFCROOF('${guid()}',#${ownerHist},'Insulated Flat Roof EPDM Membrane',$,'Roof EPDM Waterproofing',#${roofPl},#${boxShape(24.0, 18.0, 0.18)},'RF',.FLAT_ROOF.)`
	);
	addToStorey('ROOF', roofId);
	measures.set(
		roofId,
		mustMeasure([
			shiftedBoxPart(0, 0, 16.7, 24.0, 7.0, 0.18),
			shiftedBoxPart(0, 11.0, 16.7, 24.0, 7.0, 0.18),
			shiftedBoxPart(0, 7.0, 16.7, 9.0, 4.0, 0.18),
			shiftedBoxPart(15.0, 7.0, 16.7, 9.0, 4.0, 0.18)
		])
	);
	assignMat([roofId], 'EPDM Roofing Membrane', 0.18);
	recordGt('ARC-ROOF-EPDM', 'ROOF', 408.0);

	// ── 04 ARCHITECTURAL: Masonry Walls w/ Window Cutouts, 1-HR Partitions, Doors, Windows, Ceilings, Railings ──
	const masonryWallIds: number[] = [];
	const partitionWallIds: number[] = [];
	const intDoorIds: number[] = [];
	const glassDoorIds: number[] = [];
	const fireDoorOkIds: number[] = [];
	let missingFireRatingDoorExpressId = 0;
	let nonCompliantDoorExpressId = 0;
	const windowIds: number[] = [];
	const ceilingIds: number[] = [];
	const railingIds: number[] = [];

	for (const st of storeySpecs.slice(1, 5)) {
		// 4 East & West 150mm Masonry Walls per floor (each 9m long × height, containing 2 × 1.8m×1.35m window voids!)
		// Gross area = 9.0 * height; Cutout = 2 * (1.8 * 1.35) = 4.86 m²; Net area = 9.0*height - 4.86 m²
		const netMasonryArea = 9.0 * st.height - 2 * 1.8 * 1.35;
		for (const [ox, oy] of [
			[0, 0],
			[0, 9.0],
			[23.85, 0],
			[23.85, 9.0]
		] as const) {
			const pl = placeAt(st.key, ox + 0.075, oy + 4.5, 0);
			const sh = boxShape(0.15, 9.0, st.height);
			const wid = emit(
				`IFCWALL('${guid()}',#${ownerHist},'150mm Masonry Block Wall',$,'Masonry 150mm Block',#${pl},#${sh},'MW',.SOLIDWALL.)`
			);
			const op1 = emit(
				`IFCOPENINGELEMENT('${guid()}',#${ownerHist},'Window Void A',$,'Opening',#${placeAt(st.key, ox + 0.075, oy + 2.5, 1.0)},#${boxShape(0.3, 1.8, 1.35)},'WOP1',.OPENING.)`
			);
			const op2 = emit(
				`IFCOPENINGELEMENT('${guid()}',#${ownerHist},'Window Void B',$,'Opening',#${placeAt(st.key, ox + 0.075, oy + 6.5, 1.0)},#${boxShape(0.3, 1.8, 1.35)},'WOP2',.OPENING.)`
			);
			emit(`IFCRELVOIDSELEMENT('${guid()}',#${ownerHist},$,$,#${wid},#${op1})`);
			emit(`IFCRELVOIDSELEMENT('${guid()}',#${ownerHist},$,$,#${wid},#${op2})`);
			masonryWallIds.push(wid);
			addToStorey(st.key, wid);
			// Exact net mesh of 9m wall minus 2 window openings (y=[1.6..3.4] and y=[5.6..7.4], z=[1.0..2.35])
			const topH = st.height - 2.35;
			measures.set(
				wid,
				mustMeasure([
					shiftedBoxPart(ox, oy, st.elev, 0.15, 1.6, st.height), // pier 1
					shiftedBoxPart(ox, oy + 3.4, st.elev, 0.15, 2.2, st.height), // pier 2
					shiftedBoxPart(ox, oy + 7.4, st.elev, 0.15, 1.6, st.height), // pier 3
					shiftedBoxPart(ox, oy + 1.6, st.elev, 0.15, 1.8, 1.0), // sill 1
					shiftedBoxPart(ox, oy + 1.6, st.elev + 2.35, 0.15, 1.8, topH), // lintel 1
					shiftedBoxPart(ox, oy + 5.6, st.elev, 0.15, 1.8, 1.0), // sill 2
					shiftedBoxPart(ox, oy + 5.6, st.elev + 2.35, 0.15, 1.8, topH) // lintel 2
				])
			);
			recordGt('ARC-WALL-MSN150', st.key, netMasonryArea);

			// 2 Aluminium-clad awning windows filling the voids
			for (const wy of [oy + 2.5, oy + 6.5]) {
				const winId = emit(
					`IFCWINDOW('${guid()}',#${ownerHist},'Alum Awning Window 1800x1350',$,'Awning Window 1800 x 1350',#${placeAt(st.key, ox + 0.075, wy, 1.0)},#${boxShape(0.1, 1.8, 1.35)},'WN',1.35,1.8,.WINDOW.,.SINGLE_PANEL.,$)`
				);
				windowIds.push(winId);
				addToStorey(st.key, winId);
				measures.set(winId, makeBoxMeasure(ox, wy - 0.9, st.elev + 1.0, 0.1, 1.8, 1.35));
				recordGt('ARC-WIN-AWNING', st.key, 1);
			}
		}

		// 6 Interior 97mm 1-HR Fire-Rated Drywall Partitions per floor (each 6.0m × 3.0m = 18.0 m²)
		for (let pi = 0; pi < 6; pi++) {
			const px = 2.0 + (pi % 3) * 7.5;
			const py = pi < 3 ? 3.5 : 14.5;
			const pl = placeAt(st.key, px + 3.0, py, 0);
			const sh = boxShape(6.0, 0.097, 3.0);
			const pid = emit(
				`IFCWALL('${guid()}',#${ownerHist},'97mm 1-HR Fire Partition',$,'Partition 1-HR 97mm Fire',#${pl},#${sh},'PT',.PARTITIONING.)`
			);
			partitionWallIds.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeBoxMeasure(px, py - 0.0485, st.elev, 6.0, 0.097, 3.0));
			recordGt('ARC-WALL-PART1HR', st.key, 18.0);
		}

		// 6 Standard Accessible Interior Passage Doors (900mm × 2100mm)
		for (let di = 0; di < 6; di++) {
			const dx = 3.0 + (di % 3) * 7.5;
			const dy = di < 3 ? 3.5 : 14.5;
			const did = emit(
				`IFCDOOR('${guid()}',#${ownerHist},'Interior Passage Door 900x2100',$,'Single Passage Flush Interior',#${placeAt(st.key, dx, dy, 0)},#${boxShape(0.9, 0.045, 2.1)},'DR',2.1,0.9,.DOOR.,.SINGLE_SWING_LEFT.,$)`
			);
			intDoorIds.push(did);
			addToStorey(st.key, did);
			measures.set(did, makeBoxMeasure(dx - 0.45, dy - 0.0225, st.elev, 0.9, 0.045, 2.1));
			recordGt('ARC-DOOR-SGL-INT', st.key, 1);
		}

		// 1 Fire Escape Staircase Door per floor (1000mm × 2100mm) — L03 deliberately omits FireRating to test SCDF Cl. 3.9!
		const fdid = emit(
			`IFCDOOR('${guid()}',#${ownerHist},'Fire Escape Stair Door 1000x2100',$,'Single Passage Flush Interior',#${placeAt(st.key, 11.5, 7.0, 0)},#${boxShape(1.0, 0.05, 2.1)},'FDR',2.1,1.0,.DOOR.,.SINGLE_SWING_RIGHT.,$)`
		);
		addToStorey(st.key, fdid);
		measures.set(fdid, makeBoxMeasure(11.0, 6.975, st.elev, 1.0, 0.05, 2.1));
		recordGt('ARC-DOOR-SGL-INT', st.key, 1);
		if (st.key === 'L03') {
			missingFireRatingDoorExpressId = fdid;
		} else {
			fireDoorOkIds.push(fdid);
		}

		// Suspended Gypsum Ceiling (net area = 408 m² per office/lobby floor)
		const ceilId = emit(
			`IFCCOVERING('${guid()}',#${ownerHist},'Suspended Gypsum Board Ceiling',$,'Ceiling Gypsum Plasterboard',#${placeAt(st.key, 12.0, 9.0, st.height - 0.8)},#${boxShape(24.0, 18.0, 0.015)},'CLG',.CEILING.)`
		);
		ceilingIds.push(ceilId);
		addToStorey(st.key, ceilId);
		measures.set(
			ceilId,
			mustMeasure([
				shiftedBoxPart(0, 0, st.elev + st.height - 0.8, 24.0, 7.0, 0.015),
				shiftedBoxPart(0, 11.0, st.elev + st.height - 0.8, 24.0, 7.0, 0.015),
				shiftedBoxPart(0, 7.0, st.elev + st.height - 0.8, 9.0, 4.0, 0.015),
				shiftedBoxPart(15.0, 7.0, st.elev + st.height - 0.8, 9.0, 4.0, 0.015)
			])
		);
		recordGt('ARC-CEIL-GYP', st.key, 408.0);

		// 2 Stair/Atrium Balustrade Railings per floor
		for (let ri = 0; ri < 2; ri++) {
			const rid = emit(
				`IFCRAILING('${guid()}',#${ownerHist},'Stainless Glass Balustrade Railing',$,'Railing Handrail Glass Panel',#${placeAt(st.key, 10.5 + ri * 3.0, 8.8, 0)},#${boxShape(2.8, 0.08, 1.1)},'RL',.GUARDRAIL.)`
			);
			railingIds.push(rid);
			addToStorey(st.key, rid);
			measures.set(rid, makeBoxMeasure(9.1 + ri * 3.0, 8.76, st.elev, 2.8, 0.08, 1.1));
			recordGt('ARC-RAIL-BAL', st.key, 1);
		}
	}

	// 2 Double Full-Glass Lobby Entry Doors on L01 (1800mm × 2400mm)
	for (const gx of [6.0, 18.0]) {
		const gdid = emit(
			`IFCDOOR('${guid()}',#${ownerHist},'Double Full Glass Swing Entry Door',$,'Double Full Glass Swing',#${placeAt('L01', gx, 0.1, 0)},#${boxShape(1.8, 0.06, 2.4)},'GDR',2.4,1.8,.DOOR.,.DOUBLE_DOOR_SINGLE_SWING.,$)`
		);
		glassDoorIds.push(gdid);
		addToStorey('L01', gdid);
		measures.set(gdid, makeBoxMeasure(gx - 0.9, 0.07, 0, 1.8, 0.06, 2.4));
		recordGt('ARC-DOOR-DBL-GLASS', 'L01', 1);
	}

	// 1 Deliberate BCA Accessibility Violation Door on L02 (780mm < 850mm min clear width!)
	nonCompliantDoorExpressId = emit(
		`IFCDOOR('${guid()}',#${ownerHist},'Narrow Store Passage Door 780x2100',$,'Single Passage Flush Interior',#${placeAt('L02', 20.0, 14.5, 0)},#${boxShape(0.78, 0.045, 2.1)},'DR-NARROW',2.1,0.78,.DOOR.,.SINGLE_SWING_LEFT.,$)`
	);
	addToStorey('L02', nonCompliantDoorExpressId);
	measures.set(nonCompliantDoorExpressId, makeBoxMeasure(19.61, 14.4775, 4.5, 0.78, 0.045, 2.1));
	recordGt('ARC-DOOR-SGL-INT', 'L02', 1);

	assignMat(masonryWallIds, 'Masonry Concrete Block', 0.15);
	assignMat(partitionWallIds, 'Gypsum Board on Metal Stud', 0.097);
	addPset(partitionWallIds, 'Pset_WallCommon', [['FireRating', '1-HR', 'text']]);
	assignMat(
		[...intDoorIds, ...fireDoorOkIds, missingFireRatingDoorExpressId, nonCompliantDoorExpressId],
		'Solid Timber'
	);
	addPset(fireDoorOkIds, 'Pset_DoorCommon', [['FireRating', 'FD60', 'text']]);
	assignMat(glassDoorIds, 'Tempered Low-E Glass');
	assignMat(windowIds, 'Anodised Aluminium & Double Glazing');
	assignMat(ceilingIds, 'Gypsum Plasterboard', 0.015);
	assignMat(railingIds, 'Stainless Steel 316 & Laminated Glass');

	// ── 05 HVAC / ACMV: Chillers, Pumps, Exhaust Fans, Multi-storey CHW Risers, DN25 Branches + Inline Proxies, Ducts, Diffusers ──
	const sysChw = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'Chilled Water Supply & Return',$,'CHW',.CHILLEDWATER.)`
	);
	const sysDuct = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'ACMV Supply & Return Ductwork',$,'ACMV',.VENTILATION.)`
	);
	const sysCw = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'Domestic Cold Water Supply',$,'DCW',.DOMESTICCOLDWATER.)`
	);
	const sysSan = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'Sanitary Waste & Vent DWV',$,'SAN',.SEWAGE.)`
	);
	const sysGas = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'Natural Gas Distribution',$,'GAS',.GAS.)`
	);
	const sysFire = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'SCDF Fire Protection Wet Riser',$,'FIRE',.FIREPROTECTION.)`
	);
	const sysElec = emit(
		`IFCDISTRIBUTIONSYSTEM('${guid()}',#${ownerHist},'LV Electrical Power & Lighting',$,'LV',.ELECTRICAL.)`
	);

	const chwSysElems: number[] = [];
	const ductSysElems: number[] = [];
	const cwSysElems: number[] = [];
	const sanSysElems: number[] = [];
	const gasSysElems: number[] = [];
	const fireSysElems: number[] = [];
	const elecSysElems: number[] = [];

	// 2 Centrifugal Chillers (B1 Plantroom)
	const chillerIds: number[] = [];
	for (let i = 0; i < 2; i++) {
		const cx = 3.0 + i * 4.5;
		const cid = emit(
			`IFCCHILLER('${guid()}',#${ownerHist},'Water-Cooled Centrifugal Chiller 500RT',$,'Chiller 500RT HVAC',#${placeAt('B1', cx, 4.0, 0)},#${boxShape(3.2, 1.6, 2.2)},'CH',.WATERCOOLED.)`
		);
		chillerIds.push(cid);
		chwSysElems.push(cid);
		addToStorey('B1', cid);
		measures.set(cid, makeBoxMeasure(cx - 1.6, 3.2, -4.2, 3.2, 1.6, 2.2));
		recordGt('MEP-HVAC-CHILLER', 'B1', 1);
	}

	// 4 Chilled Water Pumps (B1 Plantroom)
	const pumpIds: number[] = [];
	for (let i = 0; i < 4; i++) {
		const px = 2.0 + i * 1.8;
		const pid = emit(
			`IFCPUMP('${guid()}',#${ownerHist},'Inline Chilled Water Circulator Pump',$,'Pump Circulator LPS',#${placeAt('B1', px, 6.2, 0)},#${boxShape(0.8, 0.6, 0.7)},'PM',.CIRCULATOR.)`
		);
		pumpIds.push(pid);
		chwSysElems.push(pid);
		addToStorey('B1', pid);
		measures.set(pid, makeBoxMeasure(px - 0.4, 5.9, -4.2, 0.8, 0.6, 0.7));
		recordGt('MEP-MECH-PUMP', 'B1', 1);
	}

	// 2 Rooftop Upblast Exhaust Fans (ROOF)
	const fanIds: number[] = [];
	for (let i = 0; i < 2; i++) {
		const fx = 5.0 + i * 12.0;
		const fid = emit(
			`IFCFAN('${guid()}',#${ownerHist},'Rooftop Centrifugal Exhaust Fan',$,'Fan Centrifugal Exhaust Rooftop',#${placeAt('ROOF', fx, 14.0, 0.2)},#${boxShape(1.4, 1.4, 1.2)},'FN',.CENTRIFUGALBACKWARDINCLINEDCURVED.)`
		);
		fanIds.push(fid);
		ductSysElems.push(fid);
		addToStorey('ROOF', fid);
		measures.set(fid, makeBoxMeasure(fx - 0.7, 13.3, 16.7, 1.4, 1.4, 1.2));
		recordGt('MEP-HVAC-FAN', 'ROOF', 1);
	}

	// 2 Multi-Storey Insulated DN100 Chilled Water Risers (z = -4.2m to +16.5m = 20.7m exact per riser = 41.4m total!)
	// Modelled in B1, spanning B1→L04 → automatically split proportionally by storey elevation!
	const chwRiserIds: number[] = [];
	for (let i = 0; i < 2; i++) {
		const rx = 14.1 + i * 0.35;
		const rid = emit(
			`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Chilled Water Riser DN100 Insulated',$,'Mechanical Pipe Chilled Water',#${placeAt('B1', rx, 8.0, 0)},#${cylShape(0.1, 20.7)},'CHWR',.RIGIDSEGMENT.)`
		);
		chwRiserIds.push(rid);
		chwSysElems.push(rid);
		addToStorey('B1', rid);
		measures.set(rid, makeCylinderMeasure(rx, 8.0, -4.2, 0.1, 20.7, 'z'));
		// Total length across all storeys is 20.7m (sum of split segments preserves 20.7m identically!)
		recordGt('MEP-MECH-PIPE', 'B1', 20.7);
	}
	addPset(chwRiserIds, 'Pset_Mechanical', [
		['System Type', 'Chilled Water Supply', 'text'],
		['Size', 'DN100', 'text'],
		['InsulationThickness', '0.038', 'length']
	]);

	// Legacy IFC2x3-style DN25 CHW branch pipes (IFCFLOWSEGMENT + IFCPIPESEGMENTTYPE -> auto-upgraded!)
	// Plus 2 untagged inline IFCBUILDINGELEMENTPROXY pipe spools touching the CHW branch (auto-promoted!)
	const chwPipeType = emit(
		`IFCPIPESEGMENTTYPE('${guid()}',#${ownerHist},'Insulated Chilled Water Pipe DN25',$,$,$,$,'CHW25',$,.RIGIDSEGMENT.)`
	);
	const chwBranchIds: number[] = [];
	const chwBranchUntaggedIds: number[] = [];
	const inlineProxyIds: number[] = [];
	for (const st of storeySpecs.slice(1, 5)) {
		// 2 tagged 8.0m DN25 runs per office floor + 1 untagged 4.0m run connected via port to chiller/riser
		for (let bi = 0; bi < 2; bi++) {
			const bx = 2.0 + bi * 10.0;
			const by = 5.0;
			const pid = emit(
				`IFCFLOWSEGMENT('${guid()}',#${ownerHist},'CHW Branch Run DN25',$,'Mechanical Pipe',#${placeAt(st.key, bx, by, st.height - 0.5, dirX, dirZ)},#${cylShape(0.025, 8.0)},'CHWB')`
			);
			chwBranchIds.push(pid);
			chwSysElems.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeCylinderMeasure(bx, by, st.elev + st.height - 0.5, 0.025, 8.0, 'x'));
			recordGt('MEP-MECH-PIPE-SM', st.key, 8.0);
		}
		// Untagged run connected spatially to branch #1 at x=10.01 → inherits chilled_water from network!
		const uid = emit(
			`IFCFLOWSEGMENT('${guid()}',#${ownerHist},'Contractor Untagged Pipe DN25',$,'Pipe',#${placeAt(st.key, 10.01, 5.0, st.height - 0.5, dirX, dirZ)},#${cylShape(0.025, 4.0)},'CHWU')`
		);
		chwBranchUntaggedIds.push(uid);
		addToStorey(st.key, uid);
		measures.set(uid, makeCylinderMeasure(10.01, 5.0, st.elev + st.height - 0.5, 0.025, 4.0, 'x'));
		recordGt('MEP-MECH-PIPE-SM', st.key, 4.0);

		// On L01 & L02, add an inline unclassed IFCBUILDINGELEMENTPROXY spool piece (2.0m × 25mm) touching at x=14.02!
		if (st.key === 'L01' || st.key === 'L02') {
			const pxid = emit(
				`IFCBUILDINGELEMENTPROXY('${guid()}',#${ownerHist},'Unclassed Inline Spool Piece',$,'Generic Proxy',#${placeAt(st.key, 14.02, 5.0, st.height - 0.5, dirX, dirZ)},#${cylShape(0.025, 2.0)},'PX-CHW',.NOTDEFINED.)`
			);
			inlineProxyIds.push(pxid);
			addToStorey(st.key, pxid);
			measures.set(
				pxid,
				makeCylinderMeasure(14.02, 5.0, st.elev + st.height - 0.5, 0.025, 2.0, 'x')
			);
			recordGt('MEP-MECH-PIPE-SM', st.key, 2.0);
		}
	}
	emit(
		`IFCRELDEFINESBYTYPE('${guid()}',#${ownerHist},$,$,(${[...chwBranchIds, ...chwBranchUntaggedIds].map((p) => `#${p}`).join(',')}),#${chwPipeType})`
	);
	addPset(chwBranchIds, 'Pset_Mechanical', [
		['System Type', 'Chilled Water Return', 'text'],
		['Size', '25 mm', 'text'],
		['InsulationThickness', '0.025', 'length']
	]);
	addPset(chwBranchUntaggedIds, 'Pset_Dimensions', [['Size', '25 mm', 'text']]);

	// Explicit IFC4 Port Topology linking Chiller #1 → Riser #1
	const portCh = emit(
		`IFCDISTRIBUTIONPORT('${guid()}',#${ownerHist},'Chiller Outlet',$,$,$,$,.SOURCE.,$,$)`
	);
	const portRs = emit(
		`IFCDISTRIBUTIONPORT('${guid()}',#${ownerHist},'Riser Inlet',$,$,$,$,.SINK.,$,$)`
	);
	emit(`IFCRELNESTS('${guid()}',#${ownerHist},$,$,#${chillerIds[0]},(#${portCh}))`);
	emit(`IFCRELNESTS('${guid()}',#${ownerHist},$,$,#${chwRiserIds[0]},(#${portRs}))`);
	emit(`IFCRELCONNECTSPORTS('${guid()}',#${ownerHist},$,$,#${portCh},#${portRs},$)`);

	// HVAC Rectangular Ductwork (4 × 10.0m runs per office floor = 160m) + 12 Air Diffusers per office floor (48 total)
	const ductIds: number[] = [];
	const diffuserIds: number[] = [];
	for (const st of storeySpecs.slice(1, 5)) {
		for (let di = 0; di < 4; di++) {
			const dx = 2.0 + (di % 2) * 11.0;
			const dy = di < 2 ? 4.0 : 14.0;
			const did = emit(
				`IFCDUCTSEGMENT('${guid()}',#${ownerHist},'Galv Steel Supply Duct 400x250',$,'Duct HVAC Ventilation',#${placeAt(st.key, dx + 5.0, dy, st.height - 0.45)},#${boxShape(10.0, 0.4, 0.25)},'DCT',.RIGIDSEGMENT.)`
			);
			ductIds.push(did);
			ductSysElems.push(did);
			addToStorey(st.key, did);
			measures.set(did, makeBoxMeasure(dx, dy - 0.2, st.elev + st.height - 0.45, 10.0, 0.4, 0.25));
			recordGt('MEP-HVAC-DUCT', st.key, 10.0);
		}
		for (let ai = 0; ai < 12; ai++) {
			const ax = 2.5 + (ai % 6) * 3.8;
			const ay = ai < 6 ? 3.5 : 14.5;
			const aid = emit(
				`IFCAIRTERMINAL('${guid()}',#${ownerHist},'Supply Air Swirl Diffuser 600x600',$,'Diffuser Supply Air Terminal',#${placeAt(st.key, ax, ay, st.height - 0.8)},#${boxShape(0.6, 0.6, 0.12)},'AT',.DIFFUSER.)`
			);
			diffuserIds.push(aid);
			ductSysElems.push(aid);
			addToStorey(st.key, aid);
			measures.set(
				aid,
				makeBoxMeasure(ax - 0.3, ay - 0.3, st.elev + st.height - 0.8, 0.6, 0.6, 0.12)
			);
			recordGt('MEP-HVAC-DIFFUSER', st.key, 1);
		}
	}
	addPset(ductIds, 'Pset_Mechanical', [
		['System Type', 'Supply Air Ductwork', 'text'],
		['Size', '400x250 mm', 'text']
	]);

	// ── 06 PLUMBING, SANITARY, DRAINAGE & GAS ──
	const cwMainIds: number[] = [];
	const cwBranchIds: number[] = [];
	const sanPipeIds: number[] = [];
	const gasPipeIds: number[] = [];
	const sanitaryTermIds: number[] = [];
	const fittingIds: number[] = [];
	const valveIds: number[] = [];

	for (const st of storeySpecs.slice(1, 5)) {
		// 4 × 6.0m DN32 Domestic Cold Water mains per floor
		for (let i = 0; i < 4; i++) {
			const x = 15.5 + i * 1.5;
			const pid = emit(
				`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Domestic Cold Water Copper Pipe DN32',$,'Cold Water Copper Pipe',#${placeAt(st.key, x, 11.5, st.height - 0.55, dirY, dirZ)},#${cylShape(0.032, 6.0)},'DCW32',.RIGIDSEGMENT.)`
			);
			cwMainIds.push(pid);
			cwSysElems.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeCylinderMeasure(x, 11.5, st.elev + st.height - 0.55, 0.032, 6.0, 'y'));
			recordGt('MEP-PLB-PIPE', st.key, 6.0);
		}
		// 6 × 2.5m DN20 Domestic Cold Water fixture branches per floor
		for (let i = 0; i < 6; i++) {
			const x = 15.6 + i * 1.1;
			const pid = emit(
				`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Domestic Cold Water Branch DN20',$,'Cold Water 20mm Branch',#${placeAt(st.key, x, 15.0, 1.2, dirY, dirZ)},#${cylShape(0.02, 2.5)},'DCW20',.RIGIDSEGMENT.)`
			);
			cwBranchIds.push(pid);
			cwSysElems.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeCylinderMeasure(x, 15.0, st.elev + 1.2, 0.02, 2.5, 'y'));
			recordGt('MEP-PLB-PIPE-CW-SM', st.key, 2.5);
		}
		// 4 × 5.0m DN100 Sanitary DWV waste pipes per floor
		for (let i = 0; i < 4; i++) {
			const x = 16.0 + i * 1.4;
			const pid = emit(
				`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Sanitary Waste uPVC Pipe DN100',$,'Sanitary Waste DWV uPVC',#${placeAt(st.key, x, 12.0, 0.2, dirY, dirZ)},#${cylShape(0.1, 5.0)},'SAN100',.RIGIDSEGMENT.)`
			);
			sanPipeIds.push(pid);
			sanSysElems.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeCylinderMeasure(x, 12.0, st.elev + 0.2, 0.1, 5.0, 'y'));
			recordGt('MEP-PLB-PIPE-SAN', st.key, 5.0);
		}
		// 6 Sanitary Fixtures per floor (24 total)
		for (let i = 0; i < 6; i++) {
			const x = 15.8 + i * 1.1;
			const sid = emit(
				`IFCSANITARYTERMINAL('${guid()}',#${ownerHist},'Commercial Wall-Hung WC Sanitary',$,'Toilet Sanitary Fixture',#${placeAt(st.key, x, 17.2, 0.4)},#${boxShape(0.45, 0.65, 0.42)},'WC',.TOILETPAN.)`
			);
			sanitaryTermIds.push(sid);
			sanSysElems.push(sid);
			addToStorey(st.key, sid);
			measures.set(sid, makeBoxMeasure(x - 0.225, 16.875, st.elev + 0.4, 0.45, 0.65, 0.42));
			recordGt('MEP-PLB-SANITARY', st.key, 1);
		}
		// 5 Pipe Fittings + 4 Isolation Valves per floor
		for (let i = 0; i < 5; i++) {
			const fid = emit(
				`IFCPIPEFITTING('${guid()}',#${ownerHist},'Copper Pipe Elbow Fitting DN32',$,'Elbow Tee Fitting',#${placeAt(st.key, 15.5 + i * 1.2, 11.4, st.height - 0.55)},#${boxShape(0.08, 0.08, 0.08)},'FIT',.BEND.)`
			);
			fittingIds.push(fid);
			cwSysElems.push(fid);
			addToStorey(st.key, fid);
			measures.set(
				fid,
				makeBoxMeasure(15.46 + i * 1.2, 11.36, st.elev + st.height - 0.55, 0.08, 0.08, 0.08)
			);
			recordGt('MEP-PIPE-FIT', st.key, 1);
		}
		for (let i = 0; i < 4; i++) {
			const vid = emit(
				`IFCVALVE('${guid()}',#${ownerHist},'Bronze Isolation Ball Valve DN32',$,'Valve Ball Isolation',#${placeAt(st.key, 15.5 + i * 1.5, 11.8, st.height - 0.55)},#${boxShape(0.12, 0.08, 0.1)},'VLV',.ISOLATING.)`
			);
			valveIds.push(vid);
			cwSysElems.push(vid);
			addToStorey(st.key, vid);
			measures.set(
				vid,
				makeBoxMeasure(15.44 + i * 1.5, 11.76, st.elev + st.height - 0.55, 0.12, 0.08, 0.1)
			);
			recordGt('MEP-PLB-VALVE', st.key, 1);
		}
	}

	// 6 Natural Gas Steel Pipes DN25 on B1 & L01 (retail F&B riser + header, 5.0m each = 30.0m)
	for (const stKey of ['B1', 'L01'] as const) {
		const elev = storeySpecs.find((s) => s.key === stKey)?.elev ?? 0;
		for (let i = 0; i < 3; i++) {
			const gx = 1.0 + i * 5.2;
			const pid = emit(
				`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Natural Gas Carbon Steel Pipe DN25',$,'Natural Gas Sch40',#${placeAt(stKey, gx, 1.0, 2.8, dirX, dirZ)},#${cylShape(0.025, 5.0)},'GAS',.RIGIDSEGMENT.)`
			);
			gasPipeIds.push(pid);
			gasSysElems.push(pid);
			addToStorey(stKey, pid);
			measures.set(pid, makeCylinderMeasure(gx, 1.0, elev + 2.8, 0.025, 5.0, 'x'));
			recordGt('MEP-GAS-PIPE', stKey, 5.0);
		}
	}
	addPset(cwMainIds, 'Pset_Plumbing', [
		['System Type', 'Domestic Cold Water', 'text'],
		['Size', '32 mm', 'text']
	]);
	addPset(cwBranchIds, 'Pset_Plumbing', [
		['System Type', 'Domestic Cold Water', 'text'],
		['Size', '20 mm', 'text']
	]);
	addPset(sanPipeIds, 'Pset_Plumbing', [
		['System Type', 'Sanitary Waste DWV', 'text'],
		['Size', '100 mm', 'text']
	]);
	addPset(gasPipeIds, 'Pset_Gas', [
		['System Type', 'Natural Gas', 'text'],
		['Size', '25 mm', 'text']
	]);

	// ── 07 FIRE PROTECTION: 2 Multi-Storey DN100 Wet Risers + DN50 Mains + 64 Sprinklers + 24 Smoke Detectors ──
	const firePipeIds: number[] = [];
	const sprinklerIds: number[] = [];
	const alarmIds: number[] = [];

	// 2 Multi-storey Fire Wet Risers spanning B1 → ROOF (20.7m each)
	for (let i = 0; i < 2; i++) {
		const fx = 9.4 + i * 0.4;
		const rid = emit(
			`IFCPIPESEGMENT('${guid()}',#${ownerHist},'SCDF Fire Wet Riser Pipe DN100',$,'Fire Sprinkler Wet Riser',#${placeAt('B1', fx, 7.6, 0)},#${cylShape(0.1, 20.7)},'FWR',.RIGIDSEGMENT.)`
		);
		firePipeIds.push(rid);
		fireSysElems.push(rid);
		addToStorey('B1', rid);
		measures.set(rid, makeCylinderMeasure(fx, 7.6, -4.2, 0.1, 20.7, 'z'));
		recordGt('MEP-FIRE-PIPE', 'B1', 20.7);
	}
	for (const st of storeySpecs.slice(1, 5)) {
		// 4 × 9.0m DN50 Horizontal Fire Sprinkler Pipes per floor
		for (let i = 0; i < 4; i++) {
			const fx = 2.0 + (i % 2) * 10.5;
			const fy = i < 2 ? 2.5 : 15.5;
			const pid = emit(
				`IFCPIPESEGMENT('${guid()}',#${ownerHist},'Fire Sprinkler Distribution Pipe DN50',$,'Fire Sprinkler Pipe',#${placeAt(st.key, fx, fy, st.height - 0.65, dirX, dirZ)},#${cylShape(0.05, 9.0)},'FSP',.RIGIDSEGMENT.)`
			);
			firePipeIds.push(pid);
			fireSysElems.push(pid);
			addToStorey(st.key, pid);
			measures.set(pid, makeCylinderMeasure(fx, fy, st.elev + st.height - 0.65, 0.05, 9.0, 'x'));
			recordGt('MEP-FIRE-PIPE', st.key, 9.0);
		}
		// 16 Pendent Fire Sprinklers per floor (64 total)
		for (let i = 0; i < 16; i++) {
			const sx = 2.0 + (i % 8) * 2.8;
			const sy = i < 8 ? 3.0 : 15.0;
			const sid = emit(
				`IFCFIRESUPPRESSIONTERMINAL('${guid()}',#${ownerHist},'SCDF Pendent Fire Sprinkler Head',$,'Fire Sprinkler Head',#${placeAt(st.key, sx, sy, st.height - 0.82)},#${boxShape(0.08, 0.08, 0.1)},'SPK',.SPRINKLER.)`
			);
			sprinklerIds.push(sid);
			fireSysElems.push(sid);
			addToStorey(st.key, sid);
			measures.set(
				sid,
				makeBoxMeasure(sx - 0.04, sy - 0.04, st.elev + st.height - 0.82, 0.08, 0.08, 0.1)
			);
			recordGt('MEP-FIRE-SPRINKLER', st.key, 1);
		}
		// 6 Addressable Optical Smoke Detectors per floor (24 total)
		for (let i = 0; i < 6; i++) {
			const ax = 3.0 + (i % 3) * 8.0;
			const ay = i < 3 ? 5.5 : 12.5;
			const aid = emit(
				`IFCSENSOR('${guid()}',#${ownerHist},'Addressable Optical Smoke Detector',$,'Smoke Detector Fire Alarm',#${placeAt(st.key, ax, ay, st.height - 0.82)},#${boxShape(0.12, 0.12, 0.06)},'SD',.SMOKESENSOR.)`
			);
			alarmIds.push(aid);
			fireSysElems.push(aid);
			addToStorey(st.key, aid);
			measures.set(
				aid,
				makeBoxMeasure(ax - 0.06, ay - 0.06, st.elev + st.height - 0.82, 0.12, 0.12, 0.06)
			);
			recordGt('MEP-FIRE-ALARM', st.key, 1);
		}
	}
	addPset(firePipeIds, 'Pset_FireProtection', [
		['System Type', 'Fire Protection Sprinkler', 'text'],
		['Size', '50 mm', 'text']
	]);

	// ── 08 ELECTRICAL, LIGHTING & ELV ──
	const panelIds: number[] = [];
	const trayIds: number[] = [];
	const conduitIds: number[] = [];
	const cableIds: number[] = [];
	const lightIds: number[] = [];
	const outletIds: number[] = [];

	for (const st of storeySpecs) {
		// 1 Main/Sub LV Switchboard Panelboard per storey (6 total)
		const pid = emit(
			`IFCELECTRICDISTRIBUTIONBOARD('${guid()}',#${ownerHist},'400A LV Distribution Panelboard',$,'Panelboard 400 A Switchboard',#${placeAt(st.key, 14.2, 10.2, 0.8)},#${boxShape(0.9, 0.35, 1.8)},'DB',.DISTRIBUTIONBOARD.)`
		);
		panelIds.push(pid);
		elecSysElems.push(pid);
		addToStorey(st.key, pid);
		measures.set(pid, makeBoxMeasure(13.75, 10.025, st.elev + 0.8, 0.9, 0.35, 1.8));
		recordGt('MEP-ELEC-PANEL', st.key, 1);
	}

	for (const st of storeySpecs.slice(1, 5)) {
		// 6 × 8.0m Galvanised Cable Trays per floor (192m total)
		for (let i = 0; i < 6; i++) {
			const tx = 1.5 + (i % 3) * 7.2;
			const ty = i < 3 ? 6.0 : 12.0;
			const tid = emit(
				`IFCCABLECARRIERSEGMENT('${guid()}',#${ownerHist},'HDG Perforated Cable Tray 300mm',$,'Cable Tray Trunking',#${placeAt(st.key, tx + 4.0, ty, st.height - 0.35)},#${boxShape(8.0, 0.3, 0.06)},'CT',.CABLETRAYSEGMENT.)`
			);
			trayIds.push(tid);
			elecSysElems.push(tid);
			addToStorey(st.key, tid);
			measures.set(tid, makeBoxMeasure(tx, ty - 0.15, st.elev + st.height - 0.35, 8.0, 0.3, 0.06));
			recordGt('MEP-ELEC-TRAY', st.key, 8.0);
		}
		// 8 × 4.5m EMT Electrical Conduits per floor (144m total)
		for (let i = 0; i < 8; i++) {
			const cx = 1.5 + (i % 4) * 5.2;
			const cy = i < 4 ? 2.0 : 16.0;
			const cid = emit(
				`IFCCABLECARRIERSEGMENT('${guid()}',#${ownerHist},'EMT Electrical Conduit 25mm',$,'Conduit EMT',#${placeAt(st.key, cx, cy, st.height - 0.3, dirX, dirZ)},#${cylShape(0.025, 4.5)},'CND',.CONDUITSEGMENT.)`
			);
			conduitIds.push(cid);
			elecSysElems.push(cid);
			addToStorey(st.key, cid);
			measures.set(cid, makeCylinderMeasure(cx, cy, st.elev + st.height - 0.3, 0.025, 4.5, 'x'));
			recordGt('MEP-ELEC-CONDUIT', st.key, 4.5);
		}
		// 10 × 12.0m LSOH Power & Lighting Cables per floor (480m total)
		for (let i = 0; i < 10; i++) {
			const kx = 1.0 + (i % 2) * 11.0;
			const ky = 2.0 + Math.floor(i / 2) * 3.5;
			const kid = emit(
				`IFCCABLESEGMENT('${guid()}',#${ownerHist},'LSOH XLPE Power Cable 6mm2',$,'Cable Wire LSOH',#${placeAt(st.key, kx, ky, st.height - 0.34, dirX, dirZ)},#${cylShape(0.016, 12.0)},'CBL',.CABLESEGMENT.)`
			);
			cableIds.push(kid);
			elecSysElems.push(kid);
			addToStorey(st.key, kid);
			measures.set(kid, makeCylinderMeasure(kx, ky, st.elev + st.height - 0.34, 0.016, 12.0, 'x'));
			recordGt('MEP-ELEC-CABLE', st.key, 12.0);
		}
		// 24 Recessed LED Downlights per floor (96 total)
		for (let i = 0; i < 24; i++) {
			const lx = 2.0 + (i % 8) * 2.8;
			const ly = 2.5 + Math.floor(i / 8) * 6.5;
			const lid = emit(
				`IFCLIGHTFIXTURE('${guid()}',#${ownerHist},'LED Recessed Downlight 18W',$,'Downlight Recessed Luminaire',#${placeAt(st.key, lx, ly, st.height - 0.82)},#${boxShape(0.2, 0.2, 0.08)},'LT',.POINTSOURCE.)`
			);
			lightIds.push(lid);
			elecSysElems.push(lid);
			addToStorey(st.key, lid);
			measures.set(
				lid,
				makeBoxMeasure(lx - 0.1, ly - 0.1, st.elev + st.height - 0.82, 0.2, 0.2, 0.08)
			);
			recordGt('MEP-ELEC-DOWNLIGHT', st.key, 1);
		}
		// 18 Duplex Power Socket Outlets per floor (72 total)
		for (let i = 0; i < 18; i++) {
			const ox = 1.8 + (i % 6) * 4.0;
			const oy = 0.2 + Math.floor(i / 6) * 8.5;
			const oid = emit(
				`IFCOUTLET('${guid()}',#${ownerHist},'13A Duplex Power Receptacle Outlet',$,'Receptacle Switch Outlet',#${placeAt(st.key, ox, oy, 0.45)},#${boxShape(0.14, 0.05, 0.09)},'SO',.POWEROUTLET.)`
			);
			outletIds.push(oid);
			elecSysElems.push(oid);
			addToStorey(st.key, oid);
			measures.set(oid, makeBoxMeasure(ox - 0.07, oy - 0.025, st.elev + 0.45, 0.14, 0.05, 0.09));
			recordGt('MEP-ELEC-OUTLET', st.key, 1);
		}
	}

	// ── 09 VERTICAL TRANSPORT: 2 Gearless MRL Passenger Lifts (L01 Lift Core) ──
	const liftIds: number[] = [];
	for (let i = 0; i < 2; i++) {
		const lx = 12.2 + i * 1.9;
		const lid = emit(
			`IFCTRANSPORTELEMENT('${guid()}',#${ownerHist},'Gearless MRL Passenger Lift 1350kg',$,'Passenger Lift Elevator 6-Stop',#${placeAt('L01', lx, 9.0, 0)},#${boxShape(1.7, 2.2, 2.6)},'LF',.ELEVATOR.)`
		);
		liftIds.push(lid);
		addToStorey('L01', lid);
		measures.set(lid, makeBoxMeasure(lx - 0.85, 7.9, 0, 1.7, 2.2, 2.6));
		recordGt('MEP-LIFT-PASS', 'L01', 1);
	}

	// ── 10 STANDALONE DISCONTIGUOUS TEMPORARY SCAFFOLD PROXY BAYS + EXCLUDED IFCSPACE VOLUMES ──
	const scaffoldIds: number[] = [];
	for (let i = 0; i < 4; i++) {
		const sx = 25.5;
		const sy = 2.0 + i * 4.0;
		const sid = emit(
			`IFCBUILDINGELEMENTPROXY('${guid()}',#${ownerHist},'Facade Scaffold Bay 2m',$,'Scaffold Temporary Works',#${placeAt('L01', sx, sy, 0)},#${boxShape(1.5, 2.0, 3.0)},'SCF',.NOTDEFINED.)`
		);
		scaffoldIds.push(sid);
		addToStorey('L01', sid);
		measures.set(sid, makeBoxMeasure(sx - 0.75, sy - 1.0, 0, 1.5, 2.0, 3.0));
		recordGt('GEN-SCAFFOLD-BAY', 'L01', 1);
	}
	assignMat(scaffoldIds, 'Galvanised Steel Tube');

	// 4 IFCSPACE room volumes (must be excluded automatically!)
	for (const st of storeySpecs.slice(1, 5)) {
		const spId = emit(
			`IFCSPACE('${guid()}',#${ownerHist},'Office Floor Space',$,$,#${placeAt(st.key, 12.0, 9.0, 0)},#${boxShape(22.0, 16.0, 3.0)},'Room',.ELEMENT.,.INTERNAL.,0.)`
		);
		addToStorey(st.key, spId);
	}

	// Assign IFC system groups
	const assignGroup = (sysId: number, ids: number[]) => {
		if (ids.length > 0) {
			emit(
				`IFCRELASSIGNSTOGROUP('${guid()}',#${ownerHist},$,$,(${ids.map((e) => `#${e}`).join(',')}),$,#${sysId})`
			);
		}
	};
	assignGroup(sysChw, chwSysElems);
	assignGroup(sysDuct, ductSysElems);
	assignGroup(sysCw, cwSysElems);
	assignGroup(sysSan, sanSysElems);
	assignGroup(sysGas, gasSysElems);
	assignGroup(sysFire, fireSysElems);
	assignGroup(sysElec, elecSysElems);

	// Spatial containment per storey
	for (const st of storeySpecs) {
		const members = storeyMembers.get(st.key) ?? [];
		if (members.length > 0) {
			emit(
				`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${ownerHist},$,$,(${members.map((e) => `#${e}`).join(',')}),#${storeyIds.get(st.key)})`
			);
		}
	}

	// Dummy placeholder to make sure unused helper isn't flagged
	void addQty;

	// Build exact analytical ground truth including derived items (rebar on L02–ROOF, formwork on all slabs, paint on partitions)
	const matrixByCode = new Map(matrix.map((m) => [m.code, m] as const));
	const HUNDRED = BigDecimal.fromBigInt(100n);
	const ONE = BigDecimal.fromBigInt(1n);
	const ZERO = BigDecimal.fromBigInt(0n);

	const priceQty = (item: MatrixItem, qty: number): BigDecimal.BigDecimal => {
		const q = toDecimal(qty);
		const waste = BigDecimal.max(ZERO, toDecimal(item.waste_factor_pct));
		const priced = BigDecimal.multiply(q, BigDecimal.sum(ONE, divSafe(waste, HUNDRED)));
		return BigDecimal.round(BigDecimal.multiply(priced, toDecimal(item.unit_rate)), {
			scale: 2,
			mode: 'half-from-zero'
		});
	};

	const groundTruthByCode = new Map<string, TowerGroundTruthItem>();
	let directSubtotal = ZERO;
	for (const [code, qty] of gtQty) {
		const item = matrixByCode.get(code);
		if (!item) continue;
		const amt = priceQty(item, qty);
		directSubtotal = BigDecimal.sum(directSubtotal, amt);
		groundTruthByCode.set(code, {
			matrix_code: code,
			unit: item.unit,
			quantity_basis:
				item.quantity_basis === 'count' ||
				item.quantity_basis === 'length' ||
				item.quantity_basis === 'area' ||
				item.quantity_basis === 'volume' ||
				item.quantity_basis === 'weight'
					? item.quantity_basis
					: 'count',
			expected_qty: Number(qty.toFixed(4)),
			expected_amount: moneyStr(amt)
		});
	}

	// Analytical derived items (matching buildBimCostEstimateFromExtracted storey-by-storey stands_in_for logic)
	let derivedSubtotal = ZERO;
	const derivedRules = matrix.filter(
		(m) => m.active && m.quantity_basis === 'derived' && m.derived_from && m.ratio
	);
	for (const rule of derivedRules) {
		let derivedQty = 0;
		let derivedAmt = ZERO;
		const ratioNum = Number(rule.ratio ?? 0);
		for (const [, stMap] of gtStoreyQty) {
			const srcQty = stMap.get(rule.derived_from ?? '') ?? 0;
			if (srcQty <= 0) continue;
			if (rule.stands_in_for && (stMap.get(rule.stands_in_for) ?? 0) > 0) continue;
			const dq = srcQty * ratioNum;
			derivedQty += dq;
			derivedAmt = BigDecimal.sum(derivedAmt, priceQty(rule, dq));
		}
		if (derivedQty > 0) {
			derivedSubtotal = BigDecimal.sum(derivedSubtotal, derivedAmt);
			groundTruthByCode.set(rule.code, {
				matrix_code: rule.code,
				unit: rule.unit,
				quantity_basis: 'derived',
				expected_qty: Number(derivedQty.toFixed(4)),
				expected_amount: moneyStr(derivedAmt)
			});
		}
	}

	const bimSubtotal = BigDecimal.sum(directSubtotal, derivedSubtotal);
	const contingency = BigDecimal.round(
		BigDecimal.multiply(bimSubtotal, divSafe(toDecimal(5), HUNDRED)),
		{ scale: 2, mode: 'half-from-zero' }
	);
	const totalWith5 = BigDecimal.sum(bimSubtotal, contingency);

	const ifcText = [
		'ISO-10303-21;',
		'HEADER;',
		"FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
		"FILE_NAME('Marina_Commercial_Tower_IFC4.ifc','2026-06-01T08:00:00',('Norbital Engineering'),('Norbital'),'Norbital BIM Generator','2026.1','');",
		"FILE_SCHEMA(('IFC4'));",
		'ENDSEC;',
		'DATA;',
		...lines,
		'ENDSEC;',
		'END-ISO-10303-21;',
		''
	].join('\n');

	return {
		ifcText,
		elementMeasures: measures,
		groundTruthByCode,
		expectedDirectSubtotal: moneyStr(directSubtotal),
		expectedDerivedSubtotal: moneyStr(derivedSubtotal),
		expectedBimSubtotal: moneyStr(bimSubtotal),
		expectedTotalWith5PctContingency: moneyStr(totalWith5),
		expectedDuplicateCount: 2,
		expectedPromotedProxyCount: 2,
		expectedMultiStoreyRiserCount: 4, // 2 CHW risers + 2 Fire wet risers
		nonCompliantDoorExpressId,
		missingFireRatingDoorExpressId,
		totalPhysicalAssetsAfterDedup: measures.size - 2
	};
}
