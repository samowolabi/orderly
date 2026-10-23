# Deployment field notes

Log every problem the moment it happens. For the submission, pick the best 2 or 3 and write each one fully: what happened (with the exact error), how the cause was found, the fix or workaround, and what Chord should change.

## Log

| Date | What happened | Exact error or screen | How I found it | Fix or workaround | What Chord should change |
| --- | --- | --- | --- | --- | --- |
| 2026-10-22 | Paystack connector form says the webhook secret is optional, but Connect fails without it | "webhook_secret is required" under a field labelled "(optional)" with help text "Leave blank if you're not yet on v2 webhooks" | Tried to connect with only the secret key, as the help text says | Cancelled; Orderly calls Paystack from its own API instead | Make server validation match the label, or mark the field required and explain where to find the secret |
| 2026-10-22 | Skill title ignores the frontmatter `name` | `SKILL.md` with `name: orderly-shop` showed as "Untitled skill"; a file saved as `SKILL (1).md` showed as "SKILL (1)" | Two uploads with different file names gave different titles, so the title comes from the file name | Renamed each skill by hand in Edit draft, then published | Read the title from the frontmatter `name`, and fall back to the file name only if it is missing |
| 2026-10-22 | Autonomy options have no explanation | Create teammate: "Suggest, I approve", "Work with me", "Act independently" with no descriptions | Choosing autonomy for Orderly Shop | Chose "Act independently" from the option names, since approval mode would leave reviewers' messages unanswered | Add a one-line description under each option |
| 2026-10-22 | Simulator setup step not in the brief | Had to enable Admin > Connected apps > Allow approved apps before signing in to the simulator | Instructions arrived in the credits email | Followed the email steps | Mention this step in the brief or the simulator's sign-in page |
| 2026-10-22 | No way to set a tester's identity per chat link | Create chat link only asks for a business name | Planning the two-customer race test | Open the same link in two browsers or an incognito window | Optional display name or phone per chat session |
| 2026-10-22 | Still to verify: simulator chats may be "app conversations", not WhatsApp channel conversations | Connected apps scope reads "Read app conversations" | Reviewing the simulator's granted permissions | Test handover_to_human early | If handover differs from real WhatsApp, document it for builders |

| 2026-10-23 | OpenAPI import takes a file only, and ignores the spec's security schemes | Import from OpenAPI dialog offers only "Choose File"; imported connections have empty Headers and no auth settings | Importing the deployed spec, then opening a connection's editor | Generated openapi.json locally and uploaded it; API keys go in as an X-Api-Key header on each of the 10 connections by hand | Accept a spec URL, and read securitySchemes so one key can be set per scheme instead of per endpoint |
| 2026-10-23 | No visible way to limit imported API tools to one teammate | Teammate settings > Tools lists only first-party connectors; "Add tool" links back to workspace Channels & Tools | Trying to give Orderly Shop 5 tools and Orderly Owner 8 | Confirmed by asking Orderly Shop which tools it can call: it listed all 10 imported tools (prefixed `watchtower__`, e.g. `watchtower__update_product-PATCH`), owner tools included. The API's buyer/seller keys still separate roles at the API, but Chord hands the shop agent the seller-keyed tools, so only the shop skill stops it changing prices or stock | Let each teammate pick which custom API connections it can call, as it can for first-party tools |
| 2026-10-23 | One key per connection doesn't fit tools both teammates share | list_products returns more to the owner (discount floor, off-sale items) than to customers, but a connection holds one header | Planning which key each connection gets | Shared tools use the buyer key for now; the owner sees the customer view of list_products | Per-teammate credentials on a shared connection |

## What works well (worth a line too)

- The "Draft not live" banner clearly warns that replies and simulator tests still use the published version.
- Skills have version history, so changes are easy to track.
- The OpenAPI import kept every operationId as the tool name and the descriptions as written, so tool names match the skills exactly.
- "Update selected file" in Edit draft replaces a skill's file and keeps its title, which avoids the title-from-file-name problem.
