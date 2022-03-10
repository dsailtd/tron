import { mnemonicToSeed } from "bip39";
import fromSeed, { BIP32Factory, BIP32Interface } from "bip32";
import * as ecc from "tiny-secp256k1";
//@ts-ignore
import * as tronweb from "tronweb";

// Not sure how entityId is supplied
export type entityId = string | number;

/**
 * In memory cache lookup table of derived private keys
 *
 * @interface TronKeyCache
 */
interface TronKeyCache {
  [index: string]: TronKey;
}

/**
 * Holds the private key and the Tron formatted address
 *
 * @interface TronKey
 */
interface TronKey {
  address: string;
  privKeyHex: string;
}

export interface Tronsaction {
  txID: string;
  blockNumber: number;
  block_timestamp: number;
  energy_fee: number;
  energy_usage: 0;
  energy_usage_total: number;
  internal_transactions: unknown[];
  net_fee: number;
  net_usage: number;
  raw_data: TronRawData;
  raw_data_hex: string;
  visible?: boolean;
  signautre?: string[];
  ret?: TronRet[];
}

interface TronRawData {
  contract: TronContract[];
  expiration: number;
  fee_limit: number;
  ref_block_bytes: string;
  ref_block_hash: string;
  timestamp: number;
}

interface TronContract {
  parameter: TronContractParameter;
  type: string;
}

interface TronContractParameter {
  type_url: string;
  value: {
    contrace_address: string;
    data: string;
    owner_address: string;
    [index: string]: unknown;
  };
  [index: string]: unknown;
}

interface TronRet {
  contractRet: string; //SUCCESS
  fee: number;
}

interface TronReceipt {
  result: boolean;
  txid: string;
  transaction: Tronsaction;
}

/**
 * Easy key management for Tron
 *
 * @export
 * @class Key
 */
export class Key {
  private seed: Buffer;
  private node: BIP32Interface;
  private keys: TronKeyCache = {};
  //private tronWeb: tronweb;

  constructor(private mnemonic: string, private tronWeb: tronweb) {
    // Check Length
    if (mnemonic.split(" ").length !== 12) {
      throw new Error("Phrase not 12 words long");
    }

    // Finalise construction within async syntax
    this.init();
  }

  /**
   * Continues the constructor with async syntax
   *
   * @private
   * @memberof Key
   */
  private async init() {
    const bip32 = BIP32Factory(ecc);
    this.seed = await mnemonicToSeed(this.mnemonic);
    this.node = bip32.fromSeed(this.seed);
  }

  /**
   * Generates key pair
   *
   * @private
   * @param {entityId} index
   * @returns {Promise<TronKey>}
   * @memberof Key
   */
  private async generateKeypair(index: entityId): Promise<TronKey> {
    const child = await this.node.derivePath(`m/44'/195'/${index}'/0/0`);
    if (child.privateKey) {
      const privKeyHex = child.privateKey.toString("hex");

      // TODO Check length is correct

      const address = this.tronWeb.address.fromPrivateKey(privKeyHex) as string;

      // Add to cache for easier lookup
      this.keys[index] = {
        address,
        privKeyHex,
      };

      return this.keys[index];
    } else {
      throw new Error("Node derive failed");
    }
  }

  /**
   * Gets derived private key
   *
   * @private
   * @param {entityId} index
   * @returns
   * @memberof Key
   */
  private async getHDPrivate(index: entityId) {
    // Check cache first
    if (!this.keys[index]) {
      return (await this.generateKeypair(index)).privKeyHex;
    }
    return this.keys[index].privKeyHex;
  }

  /**
   * Get tron signatured from derived entity
   *
   * @private
   * @param {entityId} index
   * @param {Tronsaction} transaction
   * @returns {Promise<Tronsaction>}
   * @memberof Key
   */
  private async getHDSignature(
    index: entityId,
    transaction: Tronsaction
  ): Promise<Tronsaction> {
    const privKeyHex = await this.getHDPrivate(index);
    return this.tronWeb.trx.sign(transaction, privKeyHex);
  }

  /**
   * Get tron address from derived entity
   *
   * @param {entityId} index
   * @returns {Promise<string>}
   * @memberof Key
   */
  public async getHDAddress(index: entityId): Promise<string> {
    // Check cache first
    if (!this.keys[index]) {
      return (await this.generateKeypair(index)).address;
    }
    return this.keys[index].address;
  }

  /**
   * Send TRX
   *
   * @param {entityId} from
   * @param {number} amount
   * @param {string} to
   * @returns {Promise<TronReceipt>}
   * @memberof Key
   */
  public async sendTrx(
    from: entityId,
    amount: number,
    to: string
  ): Promise<TronReceipt> {
    // Convert entity to address
    const fromAddr = await this.getHDAddress(from);

    // Set from for the tx builder
    // Cannot set to null, We may need to create object again for multiple address
    this.tronWeb.setAddress(fromAddr);

    // Build Transaction
    const transaction = (await this.tronWeb.transactionBuilder.sendTrx(
      to,
      amount,
      fromAddr
    )) as Tronsaction;

    // Sign
    const signedTransaction = await this.getHDSignature(from, transaction);

    // Send
    return (await this.tronWeb.trx.sendRawTransaction(
      signedTransaction
    )) as TronReceipt;
  }

  /**
   * Send TRC20
   *
   * @param {entityId} from
   * @param {number} amount
   * @param {string} to
   * @param {string} contract
   * @returns {Promise<TronReceipt>}
   * @memberof Key
   */
  public async sendTrc20(
    from: entityId,
    amount: number,
    to: string,
    contract: string
  ): Promise<TronReceipt> {
    // Convert entity to address
    const fromAddr = await this.getHDAddress(from);

    // Set from for the tx builder
    // Cannot set to null, We may need to create object again for multiple address
    this.tronWeb.setAddress(fromAddr);

    // Get Transaction
    const transaction =
      (await this.tronWeb.transactionBuilder.triggerSmartContract(
        contract,
        "transfer(address,uint256)",
        {
          feeLimit: 40000000, // they used this
          callValue: 0,
        },
        [
          {
            type: "address",
            value: to,
          },
          {
            type: "uint256",
            value: amount,
          },
        ]
      )) as Tronsaction;

    console.log("sss");

    // Sign
    const signedTransaction = await this.getHDSignature(from, transaction);

    // Send
    return (await this.tronWeb.trx.sendRawTransaction(
      signedTransaction
    )) as TronReceipt;
  }
}
