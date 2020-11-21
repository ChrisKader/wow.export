/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');
const path = require('path');
const generics = require('../../generics');
const listfile = require('../../casc/listfile');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const JSONWriter = require('../writers/JSONWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');

class M2Exporter {
	/**
	 * Construct a new M2Exporter instance.
	 * @param {BufferWrapper}
	 * @param {number} variantTexture
	 */
	constructor(data, variantTexture = 0) {
		this.m2 = new M2Loader(data);
		this.variantTexture = variantTexture;
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param {Array} mask 
	 */
	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	/**
	 * Export the textures for this M2 model.
	 * @param {string} out 
	 * @param {boolean} raw
	 * @param {MTLWriter} mtl
	 * @param {ExportHelper} helper
	 */
	async exportTextures(out, raw = false, mtl = null, helper) {
		const config = core.view.config;
		await this.m2.load();

		const useAlpha = config.modelsIncludeAlpha;

		const validTextures = {};
		for (const texture of this.m2.textures) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;
				
			let texFileDataID = texture.fileDataID;

			// Blank texture, do we have a variant texture?
			if (texFileDataID === 0) {
				texFileDataID = this.variantTexture;

				// Backward patch the variant texture into the M2 instance so that
				// the MTL exports with the correct texture once we swap it here.
				texture.fileDataID = this.variantTexture;
			}

			if (texFileDataID > 0) {
				try {
					let texFile = texFileDataID + (raw ? '.blp' : '.png');
					let texPath = path.join(path.dirname(out), texFile);

					// Default MTL name to the file ID (prefixed for Maya).
					let matName = 'mat_' + texFileDataID;
					let fileName = listfile.getByID(texFileDataID);

					if (fileName !== undefined)
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');

					// Map texture files relative to its own path.
					if (config.enableSharedTextures) {
						if (fileName !== undefined) {
							// Replace BLP extension with PNG.
							if (raw === false)
								fileName = ExportHelper.replaceExtension(fileName, '.png');
						} else {
							// Handle unknown files.
							fileName = 'unknown/' + texFile;
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = path.relative(path.dirname(out), texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);

						if (raw === true) {
							// Write raw BLP files.
							await data.writeToFile(texPath);
						} else {
							// Convert BLP to PNG.
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha);
						}
					} else {
						log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (mtl !== null) {
						mtl.addMaterial(matName, texFile);
						validTextures[texFileDataID] = matName;
					}
				} catch (e) {
					log.write('Failed to export texture %d for M2: %s', texFileDataID, e.message);
				}
			}
		}

		return validTextures;
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {ExportHelper} helper
	 */
	async exportAsOBJ(out, exportCollision = false, helper) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = core.view.config;
		const exportMeta = core.view.config.modelsExportMeta;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));
		const json = exportMeta ? new JSONWriter(ExportHelper.replaceExtension(out, '.json')) : null;

		log.write('Exporting M2 model %s as OBJ: %s', this.m2.name, out);

		// Use internal M2 name for object.
		obj.setName(this.m2.name);

		// Verts, normals, UVs
		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.setUVArray(this.m2.uv);

		// Textures
		const validTextures = await this.exportTextures(out, false, mtl, helper);

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		if (exportMeta) {
			json.addProperty('textures', this.m2.textures);
			json.addProperty('textureCombos', this.m2.textureCombos);
			json.addProperty('skin', {
				subMeshes: skin.subMeshes,
				textureUnits: skin.textureUnits
			});
		}

		// Faces
		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			// Skip geosets that are not enabled.
			if (this.geosetMask && !this.geosetMask[mI].checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			let texture = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit)
				texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

			let matName;
			if (texture && texture.fileDataID > 0 && validTextures[texture.fileDataID] !== undefined)
				matName = validTextures[texture.fileDataID];

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);
		if (json !== null)
			await json.write(config.overwriteFiles);

		if (exportCollision) {
			const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices);

			await phys.write(config.overwriteFiles);
		}
	}
}

module.exports = M2Exporter;