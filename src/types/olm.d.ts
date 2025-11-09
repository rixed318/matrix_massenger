declare module '@matrix-org/olm' {
  export function init(): Promise<void>;
  export class Account {}
  export class Session {}
  export class Utility {}
  export class PkEncryption {}
  export class PkDecryption {}
  export class PkSigning {}
  export class SAS {}
  const _default: {
    init: typeof init;
    Account: typeof Account;
    Session: typeof Session;
    Utility: typeof Utility;
    PkEncryption: typeof PkEncryption;
    PkDecryption: typeof PkDecryption;
    PkSigning: typeof PkSigning;
    SAS: typeof SAS;
  };
  export default _default;
}
