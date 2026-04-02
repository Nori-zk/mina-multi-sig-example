import {
  AccountUpdate,
  assert,
  Bool,
  method,
  Permissions,
  Provable,
  PublicKey,
  SmartContract,
  State,
  state,
  type DeployArgs,
} from 'o1js';
// VerificationKey must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey } from 'o1js';

export interface MockAdminDeployProps extends Exclude<DeployArgs, undefined> {
  adminPublicKey: PublicKey;
}

export class NoriTokenBridge extends SmartContract {
  @state(PublicKey) adminPublicKey = State<PublicKey>();

  async deploy(props: MockAdminDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey: Permissions.VerificationKey.proofOrSignature(),
      setPermissions: Permissions.impossible(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
      access: Permissions.proof(),
    });
  }

  private async ensureAdminSignature() {
    const admin = await Provable.witnessAsync(PublicKey, async () => {
      const pk = await this.adminPublicKey.fetch();
      assert(pk !== undefined, 'could not fetch admin public key');
      return pk;
    });
    this.adminPublicKey.requireEquals(admin);
    return AccountUpdate.createSigned(admin);
  }

  @method.returns(Bool)
  async canMint(_accountUpdate: AccountUpdate): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  /**
   * Update the verification key.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    await this.ensureAdminSignature();
    this.account.verificationKey.set(vk);
  }

  @method.returns(Bool)
  async canBurn(_accountUpdate: AccountUpdate): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  async canChangeAdmin(_admin: PublicKey): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  async canPause(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  async canResume(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }
}
