# Field notes: full log

Every problem hit while building Orderly on Chord, grouped by area. The five that mattered most are written up in [README.md](README.md).

## Tools and access

| Date | Problem | Evidence | Workaround | What Chord should change |
|---|---|---|---|---|
| Oct 23 | Every teammate can call every imported tool | Orderly Shop listed all of them, owner tools included: "the owner tools … are available to me" ([screenshot](screenshots/shop-lists-every-tool.png)) | Shop skill forbids owner tools; the API refuses buyer-key changes (`403 owner_only`) | Choose tools per teammate |
| Oct 23 | One key per connection doesn't fit tools both teammates share | `list_products` should show the owner more than customers, but a connection holds one header | Shared tools use the buyer key; added `owner_list_products` and `owner_list_stores` with the seller key | A credential per teammate on a shared connection |
| Oct 23 | OpenAPI import takes a file only and ignores security schemes | Only "Choose File"; imported connections had no auth headers | Uploaded the file; pasted the key into each connection by hand | Accept a spec URL; read `securitySchemes` |
| Oct 23 | Tools reach the agent under generated names | `watchtower__create_order-POST` instead of `create_order` | None needed; the agent matched them | Use the `operationId` as the tool name |
| Oct 24 | Connections don't update when the API changes | `delivery_settings` and `quote_delivery` still described old behaviour | Edited both descriptions by hand | Re-sync connections from the spec |
| Oct 22 | Paystack connector says the webhook secret is optional, but Connect fails without it | "webhook_secret is required" under a field labelled "(optional)" | Called Paystack from our own API instead | Make the validation match the label |

## Turns and history

| Date | Problem | Evidence | Workaround | What Chord should change |
|---|---|---|---|---|
| Oct 24 | A turn ends at the teammate's first text, so a progress note stops the task | "I'll try pulling it by name." then nothing; the log shows two lookups, then silence ([chat](screenshots/owner-turn-ends.png), [log](screenshots/owner-stall-log.png)) | Skill rule: look everything up first, then send one message. Re-test: six lookups, one reply ([reply](screenshots/owner-retest-reply.png), [log](screenshots/owner-retest-log.png)) | Document it, or allow an interim message |
| Oct 23 | Two messages written in one turn arrive as one | ORD-1018's receipt and "Our rider is on the way" came as a single message | The rider line is now part of the delivery receipt | Document it, or send each message separately |
| Oct 23 | Text written before a tool call reaches the customer | "The customer asked for a lower price without naming an offer, so I give the first counter…" above the counter | Skill rule: write nothing before or between tool calls | Send only the turn's final text |
| Oct 23 | The agent wrote its working into a customer message | "Price 650,000, floor 628,000, offer 600,000…" before the counter ([clean re-test](screenshots/haggle-v22-clean.png)) | The API returns ready-made counter offers, so there's no floor to leak | Keep reasoning out of replies |
| Oct 24 | The agent takes back changes it really made | "that change never went through", while the log shows `update_store` returning 200, on skill v15, which forbids this ([chat](screenshots/owner-false-retraction-v15.png), [log](screenshots/owner-update-store-log.png)); same on Oct 23 ([chat](screenshots/owner-false-retraction.png)) | Skill rule to look it up instead; it didn't hold | Keep earlier tool calls in the agent's history |
| Oct 24 | The agent invented an order and a payment link | "Held for you 👍 Order ORD-1017" with a link to Paystack's error page; the log shows no `create_order` call, and `verify_payment` for ORD-1017 returned 404 ([chat](screenshots/shop-made-up-order.png), [Paystack](screenshots/paystack-made-up-link.png)) | Skill rule (failed again on v37: ORD-1002, no `create_order`); then `quote_delivery` holds and returns the real link in the same call, removing the step. Re-test: real ORD-1002 and link, `verify_payment` 200 | Keep earlier tool calls in the agent's history, and show them in the conversation |
| Oct 24 | The agent disowned a report built from live lookups | "I wrote it without pulling live figures", after nine lookups that all returned 200 ([chat](screenshots/owner-disowns-lookups.png)) | Stronger skill rule: never disown an earlier reply | Keep earlier tool calls in the agent's history |
| Oct 23 | The agent lost an order it had just made, then made a second one | After ORD-1014, "I've paid" got "I can't see a hold or a payment link in this chat"; the next one created a new hold | Every hold message includes the order number; never create an order on "I've paid" | Keep earlier tool results in the agent's history |
| Oct 24 | No timing per reply | Replies felt slow while every API call took 5 to 560 ms | None: the time is in Chord's model turns | Show how long each reply took, split into thinking and tool calls |
| Oct 23 | No view of which tools a teammate called | Activity shows only totals ("Requests 10"); conversations offer only "Copy message" | One log line per API request, on Render, our hosting platform ([example](screenshots/api-log-ord-1010.png)) | Show each reply's tool calls |

## Simulator and messages

| Date | Problem | Evidence | Workaround | What Chord should change |
|---|---|---|---|---|
| Oct 23 | The handover message never reaches the simulator | Chord shows "One moment — connecting you with a teammate."; the simulator shows "No reply yet…" ([screenshot](screenshots/handover-discount-chord.png)) | The agent tells the customer first (didn't help); call-back email via `contact_owner` | Deliver the handover message |
| Oct 23 | An operator's reply never reaches the simulator | Reply typed in Chord is in the thread, not in the simulator ([Chord](screenshots/owner-takeover-chord.png), [simulator](screenshots/owner-takeover-simulator.png), [earlier test](screenshots/handover-operator-reply-chord.png)) | Owner gets a call-back email instead | Deliver operator replies |
| Oct 23 | A reminder's message never reaches the simulator | ORD-1010's receipt was sent in Chord 37 s after payment; the simulator showed only the link ([Chord](screenshots/receipt-and-leak-in-chord.png), [simulator](screenshots/receipt-missing-simulator.png)) | Removed reminders; the customer replies PAID | Deliver reminder messages |
| Oct 23 | Nothing outside Chord can start a teammate's turn | Paystack's webhook confirmed ORD-1018 within seconds; the customer can't be told | Customer replies PAID; the owner is emailed | An inbound webhook that starts a turn |
| Oct 23 | No buttons or suggested messages | No tool or syntax for quick replies; a chat link has only a business name, no greeting or starter prompts | The hold message says to reply PAID; suggested messages listed for testers | Quick-reply buttons, and starter prompts on chat links |
| Oct 23 | A "stay quiet" reminder posted its reasoning to the customer | "…so I'm sending nothing to the customer." | Removed reminders | A "no reply" outcome for scheduled runs |
| Oct 23 | Reminders ran a little late | Checks ran 11 to 21 s after their time ([schema](screenshots/reminder-tool-schema.png), [a run](screenshots/reminder-paid-check-run.png)); later ones showed Cancelled because a check had found the order paid ([screenshot](screenshots/reminder-never-ran.png)) | None needed | Document the scheduler's timing |
| Oct 23 | Garbled characters in a reply | Bullets showed as "â€˘" | Cleared on the next skill version | Fix the message encoding |

## Setup and console

| Date | Problem | Evidence | Workaround | What Chord should change |
|---|---|---|---|---|
| Oct 22 | Skill title comes from the file name, not the skill's `name` | `SKILL (1).md` showed as "SKILL (1)" | Renamed by hand | Read the title from the frontmatter |
| Oct 22 | Autonomy options have no descriptions | "Suggest, I approve", "Work with me", "Act independently" | Chose "Act independently" | One line under each option |
| Oct 22 | Simulator setup step isn't in the brief | Admin > Connected apps had to be allowed first | Followed the credits email | Mention it in the brief |
| Oct 22 | No tester name per chat link | Create chat link asks only for a business name | Two browsers for two customers | Optional name per chat |
| Oct 23 | No way to test as a customer inside Chord | "Test conversation" opens the operator line | Tested in the simulator | A customer-mode test chat |
| Oct 23 | Home page says nothing needs attention during handovers | "Nothing needs you" while Activity lists five escalations | Check Activity instead | Count handovers under "Needs you" |
| Oct 23 | Each reminder shows as its own conversation | Up to eight per order in the sidebar | Removed reminders | Group them under their conversation |
| Oct 23 | Starting a new simulator chat blocks on a browser dialog | A native confirm dialog froze automated testing | Clicked OK by hand | An in-page confirmation |

## Outside Chord

| Date | Problem | Evidence | Fix |
|---|---|---|---|
| Oct 24 | Delivery quotes refused area-only addresses | "sangotedo" and "chief jude street, thera miracle, sangotedo" both matched Sangotedo as an area, and were refused; the customer was asked twice for more ([chat](screenshots/area-address-retries.png)) | Quotes price from the area, say so, and the rider calls the customer; store pins still refuse vague matches |
| Oct 23 | Render, our hosting platform, sleeps on its free plan | A cold start took 22 s, close to Chord's 30 s tool timeout | Keep the API warm before tests, or use a paid instance |

## What worked well

- Skills have version history, and the "Draft not live" banner makes clear what customers get.
- The OpenAPI import kept every description as written.
- Replies are cheap: about 0.1 credit each.
- Pause and Hand back to AI make it easy to step in and out.
