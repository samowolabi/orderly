# Orderly: TSG Labs build exercise

Samuel Owolabi

**Role:** Forward-deployed Engineering (also open to Technical Product Management)

## The problem

**Who:** Kola Gadgets, a busy Yoruba man's phone shop in Lagos with three branches (Ikeja, Lekki and Yaba), sells all day on WhatsApp, and it's chaos: the same questions come in nonstop and a slow reply at 11pm loses the buyer, stock sits in three places so every "is it available?" means calling another branch, orders pile up across chats with no record but the chat itself, and every "I've paid" means digging through the bank app, so the last iPhone gets sold twice or an order goes out on a fake screenshot.

**What Orderly solves:** customers get instant answers from live stock at every branch, and the item is held with a real Paystack link in the same message, confirmed only when Paystack confirms the money, so nothing is sold twice or released on a fake screenshot, while Kola runs stock, branches and sales by chat.

**Why it's worth paying for:** one missed iPhone buyer is a ₦1,500,000 sale gone, and all three real Lagos sellers I interviewed had sold something already gone, check payments by hand ([seller interviews](docs/seller-interviews.md)), and would pay for this, either monthly (one named ₦10,000) or as a small cut per sale.

**What I left out on purpose:** product photos and full specs, promos, refunds (the owner does those in Paystack), live money and a real WhatsApp number (it runs on Paystack test mode and Chord's WhatsApp simulator), to make the core loop solid first: ask, order, pay, confirm, never sell twice.

**What I changed because of Chord:**
- **No payment reminder.** Chord's scheduled messages never reach the simulator, so a quiet buyer's hold simply runs out after 30 minutes and the stock goes back on sale.
- **The customer replies PAID.** Chord can't send a follow-up message on its own once the customer has paid, so the receipt arrives when they reply PAID. The order is still confirmed straight away by Paystack's webhook.
- **Email, not chat, for the owner.** A Chord teammate can't start a conversation, so the owner gets an email when an order is paid or needs attention.
- **A call-back instead of a live handover.** A person's reply in Chord never reaches the simulator, so a customer who asks to speak with the real owner, a person rather than the agent, leaves their number, and the owner gets an email to call them back.

**What I would build next on Chord:**
- **A morning summary.** Every morning Kola gets yesterday's sales, low stock and refunds to make, without asking. *Not built:* messages Chord sends on its own don't reach the simulator (field note 4), and each run costs credits.
- **A waiting list.** When something is sold out, customers can ask to be told when it's back, and Kola sees who's waiting when he restocks. *Not built:* telling customers it's back is a message Chord sends first, which the simulator doesn't show.

## Try it

There are two agents, both on Chord's WhatsApp simulator: **Orderly Shop** talks to Kola's customers, and **Orderly Owner** helps Kola run the shop. Chat with either the way you would on WhatsApp.

### As a customer

Open the shop chat: [chat.tsglabs.dev/c/f7lZY2nKUZl1Sm_qcTnKRs9P](https://chat.tsglabs.dev/c/f7lZY2nKUZl1Sm_qcTnKRs9P)

You're shopping at Kola Gadgets for phones and accessories: iPhones, Samsung and Tecno phones, AirPods, chargers and power banks. Talk to it the way you'd talk to a real shop: ask questions, bargain, change your mind. Here are some suggested messages to try:

| You could say | What it does |
|---|---|
| What iPhones do you have? | Live prices and stock across Ikeja, Lekki and Yaba |
| Where is your Yaba store? What time do you close? | The address, a map link, and today's hours |
| How soon can I get it in Lekki? | Driving time with traffic, plus packing time, from the nearest branch that has it |
| Can you do 600k for the iPhone 13? | It bargains, but never below the owner's floor |
| I'll take it. Deliver to 12 Admiralty Way, Lekki Phase 1. 08031234567 | A fee from the real driving distance, then the phone is held for 30 minutes with a Paystack link |
| Actually, I'll pick it up instead | It drops the delivery and moves the order to pickup |
| I want the 20W charger and AirPods Pro, I'll pick up | One order and one payment link, with each item held at the branch that has it |
| Do you have the iPhone 15 Pro? | The last unit in the business: once someone holds it, no one else can buy it |
| PAID (after paying) | Paystack confirms the payment and the receipt arrives |
| Can I speak to the owner? | It takes your number and emails the owner to call you back |

To pay, use Paystack's test card: **4084 0840 8408 4081**, any future expiry, CVV **408**, PIN **0000**, OTP **123456**. No real money moves. Reply PAID after paying: Chord can't send a follow-up message on its own, so that's what brings the receipt.

### As the owner

Open the owner chat: [chat.tsglabs.dev/c/VrYKliOZokctDkpgMNwtU4ra](https://chat.tsglabs.dev/c/VrYKliOZokctDkpgMNwtU4ra). Changes you make here show up straight away in the shop chat, so try changing a price as Kola, then ask the shop about it.

You're Kola, running three branches from your phone. Talk to it the way you'd talk to your shop manager: ask how sales are going, change prices and stock, open or close a branch. Here are some suggested messages to try:

| You could say | What it does |
|---|---|
| How did we do today? | Paid total, what sold, and anything that needs attention |
| What's in stock at Yaba? | Stock at one branch, including units held for unpaid orders |
| Add 3 more iPhone 13 to Yaba and drop the price to 630k | One read-back to confirm, then both changes in one go |
| Move 2 iPhone 14 from Ikeja to Yaba | Takes them off Ikeja and adds them to Yaba in one change |
| Add a Pixel 9 at 900k, 2 in Ikeja | It asks the lowest price you'd take if a customer bargains, then adds it |
| Lekki now closes at 6pm, and shuts on Sundays | Changes the weekly hours in one go; customers see the new times straight away |
| How much is delivery? | The base fee, the rate per km and an example trip |
| We've opened a new branch at 25 Adeniran Ogunsanya Street, Surulere, Mon to Sat 9 to 7 | Adds the store with a map pin from the address; it starts empty, so it offers to add stock |
| We're closing Yaba | It offers to move Yaba's stock to another branch first |

## Links

| What | Where |
|---|---|
| Shop agent (customer) | [chat.tsglabs.dev/c/f7lZY2nKUZl1Sm_qcTnKRs9P](https://chat.tsglabs.dev/c/f7lZY2nKUZl1Sm_qcTnKRs9P) |
| Owner agent | [chat.tsglabs.dev/c/VrYKliOZokctDkpgMNwtU4ra](https://chat.tsglabs.dev/c/VrYKliOZokctDkpgMNwtU4ra) |
| Repo | [github.com/samowolabi/orderly](https://github.com/samowolabi/orderly) |
| Recording (3 minutes) | To come |
| Field notes | [docs/field-notes/](docs/field-notes/README.md) |
| Go-live note | [docs/go-live.md](docs/go-live.md) |
