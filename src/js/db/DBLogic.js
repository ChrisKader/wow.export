/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const listfile = require('../casc/listfile');

const WDCReader = require('../db/WDCReader');

const DB_CreatureDisplayInfo = require('../db/schema/CreatureDisplayInfo');
const DB_CreatureDisplayInfoGeosetData = require('../db/schema/CreatureDisplayInfoGeosetData');
const DB_CreatureModelData = require('../db/schema/CreatureModelData');
const DB_ChrModel = require('../db/schema/ChrModel');

const DB_CharComponentTextureSections = require('../db/schema/CharComponentTextureSections');
const DB_ChrCustomizationChoice = require('../db/schema/ChrCustomizationChoice');
const DB_ChrCustomizationElement = require('../db/schema/ChrCustomizationElement');
const DB_ChrCustomizationGeoset = require('../db/schema/ChrCustomizationGeoset');
const DB_ChrCustomizationMaterial = require('../db/schema/ChrCustomizationMaterial');
const DB_ChrCustomizationOption = require('../db/schema/ChrCustomizationOption');
const DB_ChrModelTextureLayer = require('../db/schema/ChrModelTextureLayer');

const DB_TextureFileData = require('../db/schema/TextureFileData');

// Really putting too much in RAM here, need to figure out how to reduce!
const choiceToChrCustMaterialID = new Map();
const chrModelIDToTextureLayoutID = new Map();
const matResIDToFileDataID = new Map();
const creatureDisplays = new Map();
const fdidToChrModel = new Map();
const optionToChoices = new Map();
const optionsByChrModel = new Map();
const choiceToGeoset = new Map();
const geosetMap = new Map();
const creatureGeosetMap = new Map();
const chrCustMatMap = new Map();
const chrModelTexLayer = new Array();
const charComponentTextureSectionMap = new Map();

let chrCustomizationAvailable = false;

/**
 * Loads required tables.
 */
const loadTables = async () => { 
	log.write('Loading creature textures...');

	const creatureGeosetMap = new Map();

	const creatureDisplayInfoGeosetData = new WDCReader('DBFilesClient/CreatureDisplayInfoGeosetData.db2', DB_CreatureDisplayInfoGeosetData);
	await creatureDisplayInfoGeosetData.parse();
	// CreatureDisplayInfoID => Array of geosets to enable which should only be used if CreatureModelData.CreatureDisplayInfoGeosetData != 0
	for (const geosetRow of creatureDisplayInfoGeosetData.getAllRows().values()) {
		if (!creatureGeosetMap.has(geosetRow.CreatureDisplayInfoID)){
			creatureGeosetMap.set(geosetRow.CreatureDisplayInfoID, new Array());
		}

		creatureGeosetMap.get(geosetRow.CreatureDisplayInfoID).push((geosetRow.GeosetIndex + 1) * 100 + geosetRow.GeosetValue);
	}

	const creatureDisplayInfo = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2', DB_CreatureDisplayInfo);
	await creatureDisplayInfo.parse();

	const creatureDisplayInfoMap = new Map();
	const modelIDToDisplayInfoMap = new Map();
	// Map all available texture fileDataIDs to model IDs.
	for (const [displayID, displayRow] of creatureDisplayInfo.getAllRows()) {
		creatureDisplayInfoMap.set(displayID, { ID: displayID, modelID: displayRow.ModelID, textures: displayRow.TextureVariationFileDataID.filter(e => e > 0)})
		
		if (modelIDToDisplayInfoMap.has(displayRow.ModelID))
			modelIDToDisplayInfoMap.get(displayRow.ModelID).push(displayID);
		else
			modelIDToDisplayInfoMap.set(displayRow.ModelID, [displayID]);
	}

	const creatureModelData = new WDCReader('DBFilesClient/CreatureModelData.db2', DB_CreatureModelData);
	await creatureModelData.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelID, modelRow] of creatureModelData.getAllRows()) {
		if (modelIDToDisplayInfoMap.has(modelID)) {
			const fileDataID = modelRow.FileDataID;
			const displayIDs = modelIDToDisplayInfoMap.get(modelID);
			const modelIDHasExtraGeosets = modelRow.CreatureGeosetDataID > 0;

			for (const displayID of displayIDs){
				const display = creatureDisplayInfoMap.get(displayID);

				if (modelIDHasExtraGeosets){
					display.extraGeosets = Array();
					if (creatureGeosetMap.has(displayID)) {
						display.extraGeosets = creatureGeosetMap.get(displayID);
					}
				}

				if (creatureDisplays.has(fileDataID)) {
					creatureDisplays.get(fileDataID).push(display);
				} else {
					creatureDisplays.set(fileDataID, [display]);
				}
			}
		}
	}

	log.write('Loaded textures for %d creatures', creatureDisplays.size);

	const textureFileData = new WDCReader('DBFilesClient/TextureFileData.db2', DB_TextureFileData);
	await textureFileData.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [textureFileDataID, textureFileDataRow] of textureFileData.getAllRows()) {

		// TODO: Need to remap this to support other UsageTypes
		if (textureFileDataRow.UsageType != 0)
			continue;

		matResIDToFileDataID.set(textureFileDataRow.MaterialResourcesID, textureFileDataID);
	}

	// Checks if ChrModel.db2 is available -- if not we're not using Shadowlands.
	if (core.view.config.enableCharacterCustomization && listfile.getByFilename('DBFilesClient/ChrModel.db2')) {
		log.write('Loading character customization tables...');
		chrCustomizationAvailable = true;

		const chrModel = new WDCReader('DBFilesClient/ChrModel.db2', DB_ChrModel);
		await chrModel.parse();

		const chrCustomizationOption = new WDCReader('DBFilesClient/ChrCustomizationOption.db2', DB_ChrCustomizationOption);
		await chrCustomizationOption.parse();

		const chrCustomizationChoice = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2', DB_ChrCustomizationChoice);
		await chrCustomizationChoice.parse();

		for (const [chrModelID, chrModelRow] of chrModel.getAllRows()) {
			const displayRow = creatureDisplayInfo.getRow(chrModelRow.DisplayID);
			const modelRow = creatureModelData.getRow(displayRow.ModelID);
			fdidToChrModel.set(modelRow.FileDataID, chrModelID);
			chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

			for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustomizationOption.getAllRows()) {
				if (chrCustomizationOptionRow.ChrModelID != chrModelID)
					continue;

				let choiceList = Array();

				if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID)) {
					optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, new Array());
				}

				optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, name: chrCustomizationOptionRow.Name_lang });

				for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustomizationChoice.getAllRows()) {
					if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
						continue;

					// Generate name because Blizz hasn't gotten around to setting it for everything yet.
					let name = "";
					if (chrCustomizationChoiceRow.Name_lang != "") {
						name = chrCustomizationChoiceRow.Name_lang;
					} else {
						name = "Choice " + chrCustomizationChoiceRow.OrderIndex;
					}

					choiceList.push({ id: chrCustomizationChoiceID, label: name });
				}

				optionToChoices.set(chrCustomizationOptionID, choiceList);
			}
		}
		const chrCustomizationMaterial = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2', DB_ChrCustomizationMaterial);
		await chrCustomizationMaterial.parse();

		const chrCustomizationElement = new WDCReader('DBFilesClient/ChrCustomizationElement.db2', DB_ChrCustomizationElement);
		await chrCustomizationElement.parse();

		for (const [chrCustomizationElementID, chrCustomizationElementRow] of chrCustomizationElement.getAllRows()) {
			if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
				choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationGeosetID)

			if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0){
				if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID)){
					choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push(chrCustomizationElementRow);
				} else {
					choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [chrCustomizationElementRow]);
				}

				const matRow = chrCustomizationMaterial.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
				chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, MaterialResourcesID: matRow.MaterialResourcesID});
			}
		}

		const chrCustomizationGeoset = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2', DB_ChrCustomizationGeoset);
		await chrCustomizationGeoset.parse();

		for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustomizationGeoset.getAllRows()) {
			let geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');

			geosetMap.set(chrCustomizationGeosetID, Number(geoset));
		}

		const chrModelTextureLayer = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2', DB_ChrModelTextureLayer);
		await chrModelTextureLayer.parse();

		for (const [chrModelTextureLayerID, chrModelTextureLayerRow] of chrModelTextureLayer.getAllRows()) {
			if (!(chrModelTextureLayerRow.CharComponentTextureLayoutsID in chrModelTexLayer)){
				chrModelTexLayer[chrModelTextureLayerRow.CharComponentTextureLayoutsID] = new Array();
			}
			
			chrModelTexLayer[chrModelTextureLayerRow.CharComponentTextureLayoutsID][chrModelTextureLayerRow.ChrModelTextureTargetID[0]] = chrModelTextureLayerRow;
		}

		const charComponentTextureSections = new WDCReader('DBFilesClient/CharComponentTextureSections.db2', DB_CharComponentTextureSections);
		await charComponentTextureSections.parse();

		for (const [charComponentTextureSectionsID, charComponentTextureSectionsRow] of charComponentTextureSections.getAllRows()) {
			if (!charComponentTextureSectionMap.has(charComponentTextureSectionsRow.CharComponentTextureLayoutID)) {
				charComponentTextureSectionMap.set(charComponentTextureSectionsRow.CharComponentTextureLayoutID, new Array());
			}

			charComponentTextureSectionMap.get(charComponentTextureSectionsRow.CharComponentTextureLayoutID)[charComponentTextureSectionsRow.SectionType] = charComponentTextureSectionsRow;
		}

		log.write('Loaded character customization tables');
	}
}

/**
 * Gets creature skins from a given file data ID.
 * @param {number} fileDataID 
 * @returns {string|undefined}
 */
const getCreatureDisplaysByFileDataID = (fileDataID) => {
	return creatureDisplays.get(fileDataID);
};

/**
 * Returns whether or not a given file data ID is a character model.
 * @param {number} fileDataID
 * @returns {boolean}
 */
const isFileDataIDCharacterModel = (fileDataID) => {
	return fdidToChrModel.has(fileDataID);
};

/**
 * Gets ChrModelID for a given file data ID.
 * @param {number} fileDataID
 * @returns {number}
 */
const getChrModelIDByFileDataID = (fileDataID) => {
	return fdidToChrModel.get(fileDataID);
};

/**
 * Gets CharComponentTextureLayoutID for a given ChrModelID.
 * @param {number} fileDataID
 * @returns {number}
 */
const getChrComponentTextureLayoutIDByChrModelID = (chrModelID) => {
	return chrModelIDToTextureLayoutID.get(chrModelID);
};

/** 
 * Returns whether or not Character Customization is available.
 * @returns {boolean}
 */
const isCharacterCustomizationAvailable = () => {
	return chrCustomizationAvailable;
};

/** 
 * Gets available option IDs for a certain Chr Model ID.
 * @returns {array}
 */
const getOptionsByChrModelID = (chrModelID) => {
	return optionsByChrModel.get(chrModelID);
};

/** 
 * Gets available choices for a certain Option ID.
 * @returns {array}
 */
const getChoicesByOption = (optionID) => {
	return optionToChoices.get(optionID);
};

/** 
 * Gets available geosets for a certain Choice ID, returns false if there isn't one.
 * @returns {integer|boolean}
 */
const getGeosetForChoice = (choiceID) => {
	if (choiceToGeoset.has(choiceID)){
		return geosetMap.get(choiceToGeoset.get(choiceID));
	} else {
		return false;
	}
};

/** 
 * Gets TextureTargetID from ChrCustomizationMaterialID.
 * @returns {integer|boolean}
 */
const getTextureTargetByChrCustomizationMaterialID = (chrModelMaterialID) => {
	if (chrCustMatMap.has(chrModelMaterialID)) {
		return chrCustMatMap.get(chrModelMaterialID).ChrModelTextureTargetID;
	} else {
		return false;
	}
}

/**
 * Builds a list of skin materials needed for this choice.
 * TODO: This will probably need to take multiple options (one choice each) to fully work.
 * @param {integer} choiceID 
 */
const getSkinMaterialsForChoice = (modelFileDataID, choiceID) => {
	const chrModelID = fdidToChrModel.get(modelFileDataID);
	const textureLayout = getChrComponentTextureLayoutIDByChrModelID(chrModelID);
	if (!textureLayout) {
		return false;
	}
	
	let chrCustMatRows = Array();
	let materials = choiceToChrCustMaterialID.get(choiceID);
	for (const material of materials){
		chrCustMatRows.push(chrCustMatMap.get(material.ChrCustomizationMaterialID));
	}

	if (chrCustMatRows === undefined || chrCustMatRows.length == 0) {
		return false;
	}

	if (!charComponentTextureSectionMap.has(textureLayout))
		return false;

	const textureSections = charComponentTextureSectionMap.get(textureLayout);

	let skinMats = Array();

	for (let i = 0; i < chrCustMatRows.length; i++){
		const textureTarget = chrCustMatRows[i].ChrModelTextureTargetID;
		const textureLayer = chrModelTexLayer[textureLayout][textureTarget];

		// TODO: Investigate! This occurs for Orc Male HD!
		if (textureLayer === undefined)
			continue;

		for (const textureSection of textureSections){
			// Not all texture sections have to be available
			if (textureSection === undefined)
				continue;

			if (textureLayer.TextureSectionTypeBitMask == -1){
				// TODO: Non-section texture
				skinMats[textureLayer.Layer] = { TextureType: textureLayer.TextureType, FileDataID: matResIDToFileDataID.get(chrCustMatRows[i].MaterialResourcesID), size: new THREE.Vector2(1024, 512), position: new THREE.Vector2(0, 0) };
			} else {
				if (textureLayer.TextureSectionTypeBitMask & (1 << textureSection.SectionType)) {
					skinMats[textureLayer.Layer] = { TextureType: textureLayer.TextureType, FileDataID: matResIDToFileDataID.get(chrCustMatRows[i].MaterialResourcesID), size: new THREE.Vector2(textureSection.Width, textureSection.Height), position: new THREE.Vector2(textureSection.X, textureSection.Y) };
				}
			}
		}
	}

	console.log(skinMats);
	return skinMats;
}

/** 
 * Gets available textures for a certain Choice ID, returns false if there isn't one.
 * @returns {object|boolean}
 */
const getTextureForFileDataIDAndChoice = (modelFileDataID, choiceID) => {
	const chrModelID = fdidToChrModel.get(modelFileDataID);
	if (!choiceToChrCustMaterialID.has(choiceID)) {
		return false;
	}
	console.log(core.view.modelViewerChrCustCurrent);

	let chrCustMatID = 0;
	const availableChoices = choiceToChrCustMaterialID.get(choiceID);

	// Select correct material based on other choices (e.g. face material for a certain skin color)
	// core.view.modelViewerChrCustCurrent has currently selected choice IDs for by category
	core.view.modelViewerChrCustCurrent.forEach((entry) => {
		availableChoices.forEach((availableChoice) => {
			if (availableChoice.RelatedChrCustomizationChoiceID == entry){
				chrCustMatID = availableChoice.ChrCustomizationMaterialID;
			}
		});
	});

	if (chrCustMatID == 0){
		console.log("Unable to find matching choice/related choice combo for choice " + choiceID + ", falling back to first entry");
		chrCustMatID = availableChoices[0].ChrCustomizationMaterialID;
	}

	const chrCustMatRow = chrCustMatMap.get(chrCustMatID);

	if (!chrCustMatRow) {
		return false;
	}

	const textureLayout = getChrComponentTextureLayoutIDByChrModelID(chrModelID);
	if (!textureLayout) {
		return false;
	}

	const textureTarget = chrCustMatRow.ChrModelTextureTargetID;

	if (!(textureTarget in chrModelTexLayer[textureLayout])) {
		console.log("TextureTarget " + textureTarget + " not found in texture layers");
		return false;
	} else {
		const textureLayer = chrModelTexLayer[textureLayout][textureTarget];
		const textureType = textureLayer.TextureType;
		if (matResIDToFileDataID.has(chrCustMatRow.MaterialResourcesID)) {
			return { TextureType: textureType, FileDataID: matResIDToFileDataID.get(chrCustMatRow.MaterialResourcesID), TextureSectionTypeBitMask: textureLayer.TextureSectionTypeBitMask };
		} else {
			return false;
		}
	}
};

module.exports = { 
	loadTables, 
	getCreatureDisplaysByFileDataID, 
	isFileDataIDCharacterModel, 
	getChrModelIDByFileDataID, 
	isCharacterCustomizationAvailable,
	getChoicesByOption,
	getOptionsByChrModelID,
	getGeosetForChoice,
	getTextureForFileDataIDAndChoice,
	getChrComponentTextureLayoutIDByChrModelID,
	getTextureTargetByChrCustomizationMaterialID,
	getSkinMaterialsForChoice
};