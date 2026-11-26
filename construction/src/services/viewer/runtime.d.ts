declare module 'https://esm.sh/@thatopen/components@3.4.6?deps=three@0.185.1,@thatopen/fragments@3.4.6,web-ifc@0.0.77,camera-controls@3.1.2' {
	export const Components: import('./types.js').ViewerComponentsModule['Components'];
	export const Worlds: import('./types.js').ViewerComponentsModule['Worlds'];
	export const SimpleScene: import('./types.js').ViewerComponentsModule['SimpleScene'];
	export const SimpleRenderer: import('./types.js').ViewerComponentsModule['SimpleRenderer'];
	export const SimpleCamera: import('./types.js').ViewerComponentsModule['SimpleCamera'];
	export const Grids: import('./types.js').ViewerComponentsModule['Grids'];
	export const FragmentsManager: import('./types.js').ViewerComponentsModule['FragmentsManager'];
	export const Raycasters: import('./types.js').ViewerComponentsModule['Raycasters'];
}
declare module 'https://esm.sh/@thatopen/components-front@3.4.3?deps=@thatopen/components@3.4.6,@thatopen/fragments@3.4.6,three@0.185.1,web-ifc@0.0.77,camera-controls@3.1.2' {
	export const Highlighter: import('./types.js').ViewerFrontendModule['Highlighter'];
}
declare module 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77' {
	export const RenderedFaces: import('./types.js').ViewerFragmentsModule['RenderedFaces'];
	export const IfcImporter: import('./types.js').ViewerFragmentsModule['IfcImporter'];
}
declare module 'https://esm.sh/three@0.185.1' {
	export const Color: import('./types.js').ViewerThreeModule['Color'];
	export const Vector3: import('./types.js').ViewerThreeModule['Vector3'];
	export const Plane: import('./types.js').ViewerThreeModule['Plane'];
	export const Matrix4: import('./types.js').ViewerThreeModule['Matrix4'];
	export const BufferAttribute: import('./types.js').ViewerThreeModule['BufferAttribute'];
	export const BufferGeometry: import('./types.js').ViewerThreeModule['BufferGeometry'];
	export const EdgesGeometry: import('./types.js').ViewerThreeModule['EdgesGeometry'];
	export const MeshStandardMaterial: import('./types.js').ViewerThreeModule['MeshStandardMaterial'];
	export const LineBasicMaterial: import('./types.js').ViewerThreeModule['LineBasicMaterial'];
	export const Group: import('./types.js').ViewerThreeModule['Group'];
	export const Mesh: import('./types.js').ViewerThreeModule['Mesh'];
	export const LineSegments: import('./types.js').ViewerThreeModule['LineSegments'];
	export const Scene: import('./types.js').ViewerThreeModule['Scene'];
	export const PerspectiveCamera: import('./types.js').ViewerThreeModule['PerspectiveCamera'];
	export const HemisphereLight: import('./types.js').ViewerThreeModule['HemisphereLight'];
	export const DirectionalLight: import('./types.js').ViewerThreeModule['DirectionalLight'];
	export const Box3: import('./types.js').ViewerThreeModule['Box3'];
	export const WebGLRenderer: import('./types.js').ViewerThreeModule['WebGLRenderer'];
	export const DoubleSide: import('./types.js').ViewerThreeModule['DoubleSide'];
}
declare module 'https://esm.sh/web-ifc@0.0.77' {
	export const IfcAPI: import('./types.js').ViewerIfcApiConstructor;
}
declare module 'https://esm.sh/node/process.mjs' {
	const process: object;
	export default process;
}
