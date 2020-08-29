const FieldType = require('../FieldType');

module.exports = {
	ID: FieldType.Int32,
	TextureType: FieldType.Int32,
	Layer: FieldType.Int32,
	Flags: FieldType.Int32,
	Field_9_0_1_34365_004: FieldType.Int32,
	TextureSectionTypeBitMask: FieldType.Int32,
	Field_9_0_1_34365_006: [FieldType.Int32, 2],
	ChrModelTextureTargetID: [FieldType.Int32, 2],
	CharComponentTextureLayoutsID: FieldType.Relation
};