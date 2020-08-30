/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const fsp = require('fs').promises;
const path = require('path');
const ExportHelper = require('../../casc/export-helper');
const BufferWrapper = require('../../buffer');

class GLTFWriter {
	/**
	 * Construct a new GLTF writer instance.
	 * @param {string} out Output path to write to.
	 * @param {string} name Model name.
	 */
	constructor(out, name) {
		this.out = out;
		this.name = name;

		this.vertices = [];
		this.normals = [];
		this.uvs = [];
		this.bones = [];

		this.textures = new Map();
		this.meshes = [];
	}

	/**
	 * Set the texture map used for this writer.
	 * @param {Map} map 
	 */
	setTextureMap(map) {
		this.textures = map;
	}

	/**
	 * Set the bones array for this writer.
	 * @param {Array} bones 
	 */
	setBonesArray(bones) {
		this.bones = bones;
	}

	/**
	 * Set the vertices array for this writer.
	 * @param {Array} vertices 
	 */
	setVerticesArray(vertices) {
		this.vertices = vertices;
	}

	/**
	 * Set the normals array for this writer.
	 * @param {Array} normals 
	 */
	setNormalArray(normals) {
		this.normals = normals;
	}

	/**
	 * Set the UV array for this writer.
	 * @param {Array} uvs 
	 */
	setUVArray(uvs) {
		this.uvs = uvs;
	}

	/**
	 * Add a mesh to this writer.
	 * @param {string} name
	 * @param {Array} triangles 
	 * @param {string} matName
	 */
	addMesh(name, triangles, matName) {
		this.meshes.push({ name, triangles, matName });
	}

	/**
	 * Calculate the minimum and maximum values of an array buffer.
	 * @param {Array} values 
	 * @param {number} stride 
	 * @param {object} target
	 */
	calculateMinMax(values, stride, target) {
		const min = target.min = Array(stride);
		const max = target.max = Array(stride);

		for (let i = 0; i < values.length; i += stride) {
			for (let ofs = 0; ofs < stride; ofs++) {
				const currentMin = min[ofs];
				const currentMax = max[ofs];
				const value = values[i + ofs];

				if (currentMin === undefined || value < currentMin)
					min[ofs] = value;

				if (currentMax === undefined || value > currentMax)
					max[ofs] = value;
			}
		}
	}

	/**
	 * Write the GLTF file.
	 */
	async write() {
		const outGLTF = ExportHelper.replaceExtension(this.out, '.gltf');
		const outBIN = ExportHelper.replaceExtension(this.out, '.bin');

		const manifest = nw.App.manifest;
		const root = {
			asset: {
				version: '2.0',
				generator: util.format('wow.export v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid)
			},
			nodes: [
				{
					name: this.name,
					children: []
				}
			],
			scenes: [
				{
					name: this.name + 'Scene',
					nodes: [0]
				}
			],
			buffers: [
				{
					uri: path.basename(outBIN),
					byteLength: 0
				}
			],
			bufferViews: [
				{
					// Vertices ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				},
				{
					// Normals ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				},
				{
					// UVs ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				}
			],
			accessors: [
				{
					// Vertices (Float)
					bufferView: 0,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: "VEC3"
				},
				{
					// Normals (Float)
					bufferView: 1,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: "VEC3"
				},
				{
					// UVs (Float)
					bufferView: 2,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: "VEC2"

				}
			],
			skins: [
				{
					name: this.name + 'Skeleton',
					joints: [0],
				}
			],
			textures: [],
			images: [],
			materials: [],
			meshes: [],
			scene: 0
		};

		const nodes = root.nodes;
		const skin = root.skins[0];
		const rootChildren = nodes[0].children;

		const boneOffset = nodes.length;
		const bones = this.bones;

		// Mark first bone as skeleton root.
		if (bones.length > 0) {
			skin.skeleton = boneOffset;
			rootChildren.push(boneOffset);
		}

		// Bone child lookup.
		for (let i = 0, n = bones.length; i < n; i++) {
			const bone = bones[i];
			if (bone.parentBone > -1) {
				const parent = bones[bone.parentBone];
				const parentIndex = boneOffset + i;
				parent.children ? parent.children.push(parentIndex) : parent.children = [parentIndex];
			}
		}

		// Add bone nodes.
		for (let i = 0, n = bones.length; i < n; i++) {
			const bone = bones[i];
			skin.joints.push(boneOffset + i);

			const defaultAnimRot = bone.rotation.values[0];
			const defaultAnimTran = bone.translation.values[0];

			const rotation = defaultAnimRot && defaultAnimRot.length > 0 ? defaultAnimRot[0] : [0, 0, 0, 0];
			const translation = defaultAnimTran && defaultAnimTran.length > 0 ? defaultAnimTran[0] : [0, 0, 0];

			nodes.push({
				name: 'Bone_' + i,
				children: bone.children,
				rotation, translation
			});
		}

		const materialMap = new Map();
		for (const [fileDataID, texFile] of this.textures) {
			const imageIndex = root.images.length;
			const textureIndex = root.textures.length;
			const materialIndex = root.materials.length;

			root.images.push({ uri: texFile });
			root.textures.push({ source: imageIndex });
			root.materials.push({
				name: fileDataID.toString(),
				emissiveFactor: [0, 0, 0],
				pbrMetallicRoughness: {
					baseColorTexture: {
						index: textureIndex
					},
					metallicFactor: 0
				}
			});

			materialMap.set(fileDataID, materialIndex);
		}

		let triangleSize = 0;
		for (const mesh of this.meshes)
			triangleSize += mesh.triangles.length * 2;

		// Flip UV on Y axis.
		for (let i = 0; i < this.uvs.length; i += 2)
			this.uvs[i + 1] *= -1;

		const binSize = (this.vertices.length * 4) + (this.normals.length * 4) + (this.uvs.length * 4) + triangleSize;
		const bin = BufferWrapper.alloc(binSize, false);
		root.buffers[0].byteLength = binSize;

		const writeData = (index, arr, stride) => {
			const view = root.bufferViews[index];
			const accessor = root.accessors[index];

			view.byteOffset = bin.offset;
			view.byteLength = arr.length * 4;
			accessor.count = arr.length / stride;

			this.calculateMinMax(arr, stride, accessor);
			for (const node of arr)
				bin.writeFloatLE(node);
		};

		writeData(0, this.vertices, 3);
		writeData(1, this.normals, 3);
		writeData(2, this.uvs, 2);

		for (const mesh of this.meshes) {
			const bufferViewIndex = root.bufferViews.length;
			const accessorIndex = root.accessors.length;

			// Create ELEMENT_ARRAY_BUFFER for mesh indices.
			root.bufferViews.push({
				buffer: 0,
				byteLength: mesh.triangles.length * 2,
				byteOffset: bin.offset,
				target: 0x8893
			});

			// Create accessor for the mesh indices.
			root.accessors.push({
				bufferView: bufferViewIndex,
				byteOffset: 0,
				componentType: 0x1403,
				count: mesh.triangles.length,
				type: "SCALAR"
			});

			// Write indices into the binary.
			for (const idx of mesh.triangles)
				bin.writeUInt16LE(idx);

			const meshIndex = root.meshes.length;
			root.meshes.push({
				primitives: [
					{
						attributes: {
							POSITION: 0,
							NORMAL: 1,
							TEXCOORD_0: 2
						},
						indices: accessorIndex,
						mode: 4,
						material: materialMap.get(mesh.matName)
					}
				]
			});

			const nodeIndex = nodes.length;
			rootChildren.push(nodeIndex);
			nodes.push({ name: mesh.name, mesh: meshIndex });
		}

		await fsp.writeFile(outGLTF, JSON.stringify(root, null, '\t'), 'utf8');
		await bin.writeToFile(outBIN);
	}
}

module.exports = GLTFWriter;