const notSupported = (name) => {
  throw new Error(`@matrix-org/olm stub: ${name} is not available in this environment.`);
};

export async function init() {
  // no-op stub to satisfy dynamic import paths when the real Olm is unavailable.
}

class Unsupported {
  constructor(name) {
    notSupported(name);
  }
}

export class Account extends Unsupported {
  constructor() {
    super('Account');
  }
}

export class Session extends Unsupported {
  constructor() {
    super('Session');
  }
}

export class Utility extends Unsupported {
  constructor() {
    super('Utility');
  }
}

export class PkEncryption extends Unsupported {
  constructor() {
    super('PkEncryption');
  }
}

export class PkDecryption extends Unsupported {
  constructor() {
    super('PkDecryption');
  }
}

export class PkSigning extends Unsupported {
  constructor() {
    super('PkSigning');
  }
}

export class SAS extends Unsupported {
  constructor() {
    super('SAS');
  }
}

export default {
  init,
  Account,
  Session,
  Utility,
  PkEncryption,
  PkDecryption,
  PkSigning,
  SAS,
};
