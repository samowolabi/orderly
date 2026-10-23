export class NotifierUnavailable extends Error {}

export type OwnerMessage = {
  subject: string;
  text: string;
};

export interface Notifier {
  readonly name: string;

  // Sends one message to the shop owner.
  notifyOwner(message: OwnerMessage): Promise<void>;
}
