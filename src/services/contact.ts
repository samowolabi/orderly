import { notifier } from "../adapters";
import { config } from "../config";
import { pool } from "../db/pool";
import { ownerEmailHtml, ownerEmailText, type OwnerEmail } from "../utils/email-template";
import { orderSummary } from "./orders";
import { logEvent } from "./stock";

type ContactOwnerInput = {
  name: string;
  phone: string;
  reason: string;
  order_id?: string;
};

// A number gets at most one email in this window, so the owner's inbox can't be flooded.
const REPEAT_MINUTES = 30;

// Emails the owner that a customer wants to talk to them, with the number to call back.
// Chord can't pass a person's reply back to the simulator, so the owner calls instead.
export async function contactOwner(input: ContactOwnerInput) {
  const phoneKey = input.phone.replace(/\D/g, "").slice(-10);
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM owner_contacts
     WHERE phone_key = $1 AND emailed AND created_at > now() - make_interval(mins => $2::int)`,
    [phoneKey, REPEAT_MINUTES],
  );
  if (recent.length) {
    return {
      status: "already_requested" as const,
      next_step: `The owner already has their request from the last ${REPEAT_MINUTES} minutes. Reassure them the owner will call ${input.phone}, then call handover_to_human.`,
    };
  }

  const order = input.order_id ? await orderSummary(input.order_id) : null;
  const email: OwnerEmail = {
    heading: `${input.name} wants to talk to you`,
    intro: "A customer asked the shop assistant for a real person. Call or WhatsApp them back.",
    details: [
      ["Name", input.name],
      ["Phone", input.phone],
      ["About", input.reason],
      ...(order ? ([["Order", `${order.id} · ${order.total} · ${order.status.replace(/_/g, " ")}`]] as [string, string][]) : []),
    ],
    ...(order ? { list: { title: "In the order", items: order.items } } : {}),
    footer: `Sent by Orderly for ${config().BUSINESS_NAME}.`,
  };

  let emailed = false;
  try {
    const sender = notifier();
    if (sender.name !== "none") {
      await sender.notifyOwner({ subject: `Call back: ${input.name} wants to talk to you`, text: ownerEmailText(email), html: ownerEmailHtml(email) });
      emailed = true;
    }
  } catch (error) {
    console.error(`[notify] contact_owner: ${(error as Error).message}`);
  }

  await pool.query(
    "INSERT INTO owner_contacts (name, phone, phone_key, reason, order_id, emailed) VALUES ($1, $2, $3, $4, $5, $6)",
    [input.name, input.phone, phoneKey, input.reason, order?.id ?? null, emailed],
  );
  await logEvent(pool, order?.id ?? null, "owner_contact_requested", { emailed });

  return emailed
    ? {
        status: "sent" as const,
        next_step: `The owner has their number. Tell them the owner will call or WhatsApp ${input.phone} shortly, then call handover_to_human.`,
      }
    : {
        status: "not_sent" as const,
        next_step: "The owner couldn't be reached by email. Tell them someone from the shop will get back to them, then call handover_to_human.",
      };
}
