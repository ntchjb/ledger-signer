import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

export type Transports = typeof TransportNodeHid;

export const transports = {
  hid: TransportNodeHid,
  default: TransportNodeHid,
};
