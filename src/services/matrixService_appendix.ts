// Append these exports to your existing services/matrixService.ts (at the bottom).
// They proxy to the new E2EE module without disrupting existing imports.
export { 
  ensureCryptoReady,
  getCrossSigningKeyId,
  startAutoBackupLoop,
  onDevicesUpdated,
  getRoomSelfDestructConfig,
  setRoomSelfDestructConfig,
  attachSelfDestructMarker,
  scheduleSelfDestructRedaction,
  exportRoomKeysAsJson,
  importRoomKeysFromJson,
  saveEncryptedSeed,
  loadEncryptedSeed,
} from './e2eeService';
