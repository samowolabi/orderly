# Orderly: Product Requirements

**Orderly turns WhatsApp into the store.** The owner manages products and stock by chat, and customers order, pay through Paystack and get a receipt without anyone leaving WhatsApp.

*Never sell twice. Never chase an alert.*

## The problem

Small Lagos sellers run their whole business on WhatsApp, and every order is a manual loop: quote, check stock, send account details, then check the bank app by hand.

Three sellers were asked how they handle it:

| What happens | How many of 3 |
| --- | --- |
| Sold an item that was already gone | 3 |
| Check the bank by hand before releasing an order | 3 |
| Lose buyers who ask, then disappear | 3 |
| Run more than one store or branch | 2 |
| Worried about fake payment alerts | 1 |

One seller put it simply: they rush to make the sale, then find the item has already been sold. Two named a price: ₦10,000 a month, or a percentage per sale.

## Who it is for

Two users, two AI teammates on Chord, one shared store. The demo business is Kola Gadgets, a made-up phone store with stores in Ikeja and Lekki.

| User | Teammate | Where they chat | What they want |
| --- | --- | --- | --- |
| Owner | Orderly Owner | Chord direct line, or an owner chat link | Add stock, see what sold, never oversell |
| Customer | Orderly Shop | WhatsApp | Quick answers, a safe way to pay, a receipt |

## What Orderly does

These are the core features. Each one answers something the sellers raised.

**For the owner (Orderly Owner)**

- **Add products by chat:** "Add iPhone 13, 128GB, ₦650,000, 2 at Ikeja, 1 at Lekki."
- **Update stock per store:** "Add 3 more to Lekki."
- **Manage stores:** "We opened a new store in Yaba", "Lekki now closes at 8pm" or "Send me the Ikeja location."
- **See orders:** "What sold today?" shows paid, pending and expired orders.

**For the customer (Orderly Shop)**

- **Ask price and stock:** answered live, including which store has it.
- **Order and pay:** the item is held for 30 minutes and a Paystack payment link is sent.
- **Payment confirmed for real:** a signed Paystack webhook confirms the order, with an explicit Paystack check as fallback. A screenshot is never accepted as proof.
- **Receipt:** sent in chat as soon as payment is confirmed.
- **One reminder:** if the customer goes quiet, one nudge after 20 minutes.
- **A real person when needed:** anything unusual is handed to the owner instead of guessed.

## Rules it never breaks

These are enforced by Orderly's own API, not just by the AI's instructions.

1. **Never sell twice.** Stock is held the moment an order is created, so two customers can't buy the last unit.
2. **Never confirm without Paystack.** Signed notifications and "I've paid" checks both validate the payment amount and currency.
3. **Never invent a price or stock level.** Every figure comes from the store's records.
4. **Customers can't change anything.** Orderly Shop has no access to the owner's tools.
5. **Late payment is handled honestly.** If someone pays after their hold expired and the item is gone, they are told, and the owner is alerted to refund.

## Later, and left out

| When | What |
| --- | --- |
| Next if time | Promo codes; an end-of-day sales summary for the owner |
| Stretch | Discount requests approved by Orderly Owner within a price floor; PDF receipts |
| Designed, not built | Refunds through Paystack, ready to build if reviewers ask |
| Left out | Delivery booking, product photos, multiple businesses, real payments or phone numbers |

## How we know it works

Orderly is ready when every check below passes in the WhatsApp simulator.

- [ ] Owner adds a phone; a customer orders it, pays with a Paystack test card, and gets a receipt
- [ ] Two customers try to buy the last unit at once; only one gets it
- [ ] A declined card is not confirmed, and a new link is offered
- [ ] "I've paid" before paying is checked and corrected
- [ ] A quiet customer gets one reminder; their hold expires and stock returns
- [ ] An unusual question is handed to a person
- [ ] Orderly Shop refuses when asked to change a price

## Risks and open questions

| Risk | What we do about it |
| --- | --- |
| Handover to a person may not work in the simulator | Tell the customer a person will follow up, flag the order for the owner, and note it in the field notes |
| Owners may not trust an AI with customers | Hand over anything unusual; the owner sees every handed-off chat |
| "Bumpa already does this" | Orderly lives inside WhatsApp, with no extra app, and hands over to a person |
| Paystack needs a customer email that WhatsApp buyers rarely give | Use a placeholder in test mode; ask for an email before going live |

**Still open:** anyone with the owner chat link acts as the owner. That is fine for the demo, but going live needs owner access locked to the owner's number.
