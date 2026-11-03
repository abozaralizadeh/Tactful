# Roadmap

Where the project is and where it could go. For how it's built, see [DESIGN.md](DESIGN.md).

## The idea to prove

The whole product depends on one thing: can AI rewrite an angry message so it's calmer and still says what the person meant? If it can't, a nice chat around it doesn't matter. So the rewrite has its own test, separate from the chat.

## Where it stands

| Part | State |
| --- | --- |
| Chat app (backend and web) | Built, with automated tests |
| Rewrite | Runs on a local fake made of simple rules. A Claude provider is written but has only been tested against a stubbed response, never the real API |
| 50 message rewrite test | The harness and the 50 messages exist and run. It can't be scored for real until a real provider is plugged in |
| `setup_service.sh` | Written and syntax checked. Not run on a real server yet |
| Privacy notice and terms | Template text in the app. Replace the bracketed parts and get it reviewed before real use |
| Real devices and screen readers | Only checked in a desktop browser so far |

## First small version (built)

- A web app that works well on a phone.
- One person starts a conversation, describes the problem in a line or two, and gets an invite link.
- The other person opens the link, reads what the app does, agrees, and joins.
- Either person writes a message and sees the rewritten version. They can send it, edit it, ask for another, or cancel.
- The other person receives it live, marked as rewritten.
- Threats and similar are stopped, not sent, and the sender is told why.
- Either person can close the conversation. It's deleted after 30 days.
- English only.

Not in it: accounts, native apps, more than two people, AI suggestions beyond rewriting, push notifications or email, attachments, images or voice.

## What would make the rewrite test mean something

1. Run `npm run rewrite-test` with a real provider key.
2. Read the results and score each one on two questions: is it calm, and does it keep the meaning?
3. The bar is 45 of 50 passing and every threat stopped. Change the prompt in `server/rewriter/anthropic.ts` until it gets there.

The fake gets 42 of 50 with every threat stopped. That only shows the harness works. Please don't tune the fake to pass.

## Ideas for later

Roughly in this order, and only if people want them:

1. Reopening a conversation from another device.
2. Notifications when a new message arrives.
3. Other languages, where each person writes and reads in their own.
4. More than rewriting: a neutral summary of where you agree and where you don't, then suggested middle ground.
5. Mobile apps.

## Help wanted

- Try the rewrite test with different providers and models, and share what you find.
- Read the 50 messages in `data/heated-messages.json` and tell us which are unrealistic or missing.
- Screen reader and real phone testing.
- Translations.
