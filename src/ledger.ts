import { ethers } from "ethers";

import { version } from "./_version";
const logger = new ethers.utils.Logger(version);

import Eth from "@ledgerhq/hw-app-eth";

// We store these in a separated import so it is easier to swap them out
// at bundle time; browsers do not get HID, for example. This maps a string
// "type" to a Transport with create.
import { transports } from "./ledger-transport";
import { TransportError } from "@ledgerhq/hw-transport";

const defaultPath = "44'/60'/0'/0/0";

function waiter(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

interface ITransportError extends Error {
  name: "TransportError";
  message: string;
  stack?: string;
  id: string;
}

export class LedgerSigner extends ethers.Signer {
  readonly _eth: Promise<Eth>;

  constructor(
    readonly provider?: ethers.providers.Provider,
    readonly type: keyof typeof transports = "default",
    readonly path: string = defaultPath
  ) {
    super();

    const transport = transports[type];
    if (transport === undefined) {
      logger.throwArgumentError("unknown or unsupported type", "type", type);
    }

    this._eth = transport.create().then(
      async (transport) => {
        const eth = new Eth(transport);
        await eth.getAppConfiguration();
        return eth;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  _retry<T = any>(
    callback: (eth: Eth) => Promise<T>,
    timeout?: number
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      if (timeout && timeout > 0) {
        setTimeout(() => {
          reject(new Error("timeout"));
        }, timeout);
      }

      const eth = await this._eth;

      // Wait up to 5 seconds
      for (let i = 0; i < 50; i++) {
        try {
          const result = await callback(eth);
          return resolve(result);
        } catch (error) {
          if (error instanceof TransportError) {
            const err = error as ITransportError;
            if (err.id !== "TransportLocked") {
              return reject(error);
            }
          }
        }
        await waiter(100);
      }

      return reject(new Error("timeout"));
    });
  }

  async getAddress(): Promise<string> {
    const account = await this._retry((eth) => eth.getAddress(this.path));
    return ethers.utils.getAddress(account.address);
  }

  async signMessage(message: ethers.utils.Bytes | string): Promise<string> {
    if (typeof message === "string") {
      message = ethers.utils.toUtf8Bytes(message);
    }

    const messageHex = ethers.utils.hexlify(message).substring(2);

    const sig = await this._retry((eth) =>
      eth.signPersonalMessage(this.path, messageHex)
    );
    sig.r = "0x" + sig.r;
    sig.s = "0x" + sig.s;
    return ethers.utils.joinSignature(sig);
  }

  async signTransaction(
    transaction: ethers.providers.TransactionRequest
  ): Promise<string> {
    const tx = await ethers.utils.resolveProperties(transaction);
    const baseTx: ethers.utils.UnsignedTransaction = {
      chainId: tx.chainId || undefined,
      data: tx.data || undefined,
      gasLimit: tx.gasLimit || undefined,
      nonce: tx.nonce ? ethers.BigNumber.from(tx.nonce).toNumber() : undefined,
      type: tx.type,
      to: tx.to || undefined,
      value: tx.value || undefined,
    };

    if (tx.type === 2) {
      baseTx.maxFeePerGas = tx.maxFeePerGas;
      baseTx.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    } else {
      baseTx.gasPrice = tx.gasPrice;
    }

    const unsignedTx = ethers.utils.serializeTransaction(baseTx).substring(2);
    // for resolution
    // import ledgerService from '@ledgerhq/hw-app-eth/lib/services/ledger';
    // const resolution = await ledgerService.resolveTransaction(rawTxHex);
    const sig = await this._retry((eth) =>
      eth.signTransaction(this.path, unsignedTx, null)
    );

    return ethers.utils.serializeTransaction(baseTx, {
      v: ethers.BigNumber.from("0x" + sig.v).toNumber(),
      r: "0x" + sig.r,
      s: "0x" + sig.s,
    });
  }

  connect(provider: ethers.providers.Provider): ethers.Signer {
    return new LedgerSigner(provider, this.type, this.path);
  }
}
