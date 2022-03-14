import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

export type Transports = typeof TransportNodeHid;

export const transports: { [name: string]: Transports } = {
  hid: TransportNodeHid,
  default: TransportNodeHid,
};
