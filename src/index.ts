import { EventEmitter } from "events";
import axios, { AxiosResponse } from "axios";
import { Key, entityId, Tronsaction, Trc20saction } from "./key";
//@ts-ignore
import * as tronweb from "tronweb";

// How long to wait before calling the running again
const RUNNER_TIMEOUT = 60000;

// Confirmation typically takes 19 blocks, Usually 90 seconds. We have an added buffer
const BACKDATED_POLL = 3;

export interface Transaction {
  address: string;
  transactions: {
    trx: Tronsaction[];
    trc20: Trc20saction[];
  };
  balance: null | AccountBalance;
}

interface AccountBalance {
  trx: number;
  trc20: unknown[]; // TODO Design this
}

/**
 * Helper class for working with Tron.
 *
 * @export
 * @class Tron
 */
export class Tron extends EventEmitter {
  /**
   * Flag for controlling the network listner
   *
   * @private
   * @memberof Tron
   */
  private running = false;

  /**
   * Array of addresses to watch for transactions
   *
   * @public
   * @type {string[]}
   * @memberof Tron
   */
  public wallets: Set<string> = new Set<string>();

  /**
   * Tron web object, Used for managing keys and transactions
   *
   * @private
   * @type {tronweb}
   * @memberof Tron
   */
  private tronWeb: tronweb;

  /**
   * Transaction fetching uses this to filter
   *
   * @private
   * @type {number}
   * @memberof Tron
   */
  private lastPullBlockTimestamp: number;

  /**
   * Tron new event plugin http api url (Not built into tronweb)
   *
   * @private
   * @type {string}
   * @memberof Tron
   */
  private eventHttpWrapper: string;

  /**
   * Manages keys in memory
   *
   * @type {Key}
   * @memberof Tron
   */
  public keyManager: Key;

  constructor(private mnemonic: string, network: "main" | "shasta" = "shasta") {
    super();
    switch (network) {
      default:
      case "main":
        this.tronWeb = new tronweb({
          fullNode: "https://api.trongrid.io",
          solidityNode: "https://api.trongrid.io",
          eventServer: "https://api.trongrid.io",
        });
        this.eventHttpWrapper = "https://api.trongrid.io/v1";
      case "shasta":
        this.tronWeb = new tronweb({
          fullNode: "https://api.shasta.trongrid.io",
          solidityNode: "https://api.shasta.trongrid.io",
          eventServer: "https://api.shasta.trongrid.io",
        });
        this.eventHttpWrapper = "https://api.shasta.trongrid.io/v1";
        break;
    }

    // Build Key Manager
    this.keyManager = new Key(this.mnemonic, this.tronWeb);
  }

  /**
   * Proxy call to get address, We will put it into our lookup cache
   *
   * @param {entityId} index
   * @returns {Promise<string>}
   * @memberof Tron
   */
  public async getHDAddress(index: entityId): Promise<string> {
    const address = await this.keyManager.getHDAddress(index);
    this.wallets.add(address);
    return address;
  }

  /**
   * Add new wallets to the service
   *
   * @param {(string | string[])} wallet
   * @memberof Tron
   */
  public addWallet(wallet: string | string[]): void {
    if (Array.isArray(wallet)) {
      for(const w of wallet){
        this.wallets = this.wallets.add(w);
      }
    } else {
      this.wallets.add(wallet);
    }
  }

  /**
   * Determines if tron api response was successfull
   *
   * @private
   * @param {*} trx
   * @param {*} trc20
   * @returns {boolean}
   * @memberof Tron
   */
  private isSuccessful(trx: any, trc20: any): boolean {
    // Was TRX a valid response
    if (
      (trx.success && trx.data.length) ||
      (trc20.success && trc20.data.length)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Timer runs through all the wallets fetching transactions
   *
   * @private
   * @memberof Tron
   */
  private async runPolling() {
    // Cache next timestamp, At this point we don't know how long the below
    // will take to run and that would create a void in the timestamp check of transaction
    // the downside of this is in that same void we may get multiple transactions but this is negated due to unique txID
    const cacheTimeStamp = new Date(
      Date.now() - BACKDATED_POLL * 1000 * 60
    ).getTime();

    // Use a for so we can await each request
    for (const wallet of this.wallets) {
      if (!this.running) {
        continue;
      }
      // const wallet = this.wallets[i];
      let transactionResponse : AxiosResponse<any, any>;
      try {
        transactionResponse = await axios.get(
          `${this.eventHttpWrapper}/accounts/${wallet}/transactions?only_confirmed=true&limit=200&min_timestamp=${this.lastPullBlockTimestamp}`
        );
      } catch (err) {
        console.log(`ERROR[@${new Date()}]: TRX transaction get response error`)
        console.log(err)
        continue;
      }

      let trc20Response : AxiosResponse<any, any>;
      try {
        trc20Response = await axios.get(
          `${this.eventHttpWrapper}/accounts/${wallet}/transactions/trc20?only_confirmed=true&limit=200&min_timestamp=${this.lastPullBlockTimestamp}`
        );
      } catch (err) {
        console.log(`ERROR[@${new Date()}]: TRC20 transaction get response error`)
        console.log(err)
        continue;
      }

      // Check for success and there are transactions to emit
      if (!this.isSuccessful(transactionResponse.data, trc20Response.data)){
        // No new data
        continue;
      }

      // Lets fetch balance view as well from this new event plugin api
      let balanceResponse : AxiosResponse<any, any>;
      try {
        balanceResponse = await axios.get(
          `${this.eventHttpWrapper}/accounts/${wallet}/?only_confirmed=true`
        );
      } catch (err) {
        console.log(`ERROR[@${new Date()}]: Balance get response error`)
        console.log(err)
        continue;
      }

      // Create emitted event data 
      const emit = {
        address: wallet,
        transactions: {
          trx: transactionResponse.data.data,
          trc20: trc20Response.data.data,
        },
        balance: null,
      } as Transaction;

      // check for success response and values not null
      if (
        balanceResponse.data?.success &&
        balanceResponse.data.data.length
      ) {
        emit.balance = {
          trx: balanceResponse.data.data[0].balance,
          trc20: balanceResponse.data.data[0].trc20,
        };
        this.emit("transactions", emit);
      } else {
        // Emit!
        this.emit("transactions", emit);
      }
    }

    // Timestamp is aribatary lookup in the Tron Event
    this.lastPullBlockTimestamp = cacheTimeStamp;

    // check we are still running
    if (this.running) {
      setTimeout(() => {
        this.runPolling();
      }, RUNNER_TIMEOUT);
    }
  }

  /**
   * Starts polling for transactions
   *
   * @param {number} timestamp
   * @memberof Tron
   */
  public async startPolling(timestamp: number) {
    // Get the last block timestamp
    //const block = await this.tronWeb.trx.getBlock(lastKnownblock);

    // Anytime stamp works.
    this.lastPullBlockTimestamp = timestamp;

    // start Runner
    this.running = true;
    this.runPolling();
  }

  /**
   * Gracefully stop the listener
   *
   * @memberof Tron
   */
  public stopPolling() {
    this.running = false;
  }
}
