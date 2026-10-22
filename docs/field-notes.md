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

## What works well (worth a line too)

- The "Draft not live" banner clearly warns that replies and simulator tests still use the published version.
- Skills have version history, so changes are easy to track.
