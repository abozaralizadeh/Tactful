# Data handling

What the service stores, for how long, and who can see it. This is what the code does today. If you run your own copy, you are the one responsible for the data on it, so use this as a starting point for your own privacy notice. It isn't legal advice.

## What is stored

| Data | Where | Why | Kept for |
| --- | --- | --- | --- |
| Topic (a line or two the starter writes) | `conversations.topic` | The other person sees it before joining | With the conversation |
| Display names | `participants.display_name` | Shown in the chat | With the conversation |
| Approved messages (the rewritten text) | `messages.approved_text` | The conversation itself | With the conversation |
| Original text while previewing | `drafts.original_text` | So "try again" works | Until sent, cancelled, replaced or closed, and 1 hour at most |
| Rewritten text while previewing | `drafts.rewritten_text` | The preview | Same as above |
| Access tokens and invite tokens | Only as a sha256 hash | Find who is asking | With the conversation (an invite hash is cleared once used) |
| Consent time and last seen time | `participants` | Housekeeping | With the conversation |
| Rewrite counts (outcome, time taken, tokens) | `rewrite_events` | Quality, speed and cost | With the conversation |
| Usage counts (started, joined, sent, edited, retried, cancelled, closed) | `usage_events` | See how people use it | With the conversation |
| Request log lines | `logs/tactful.log` and the system journal | Find faults | Log rotation, 10 MB x 5 files for the file |

Names, topics and messages are free text, so they can hold personal or sensitive data. The count tables never hold text.

Request log lines hold the method, the route pattern, the status code and the time. No URL, query string, header, body or IP address.

## What is not stored

- Passwords, accounts, email addresses or phone numbers. There are none.
- Cookies. The app sets none. The browser keeps the invite link for a started conversation in local storage.
- The IP address, apart from a short lived in memory counter for rate limits that is never written to disk or logs.
- Original text of a message that was stopped or needed a clearer point. It is not saved at all.
- Message text in any log.

## Who else sees the data

| Party | What they get |
| --- | --- |
| The other person in the chat | The topic, your name, and the rewritten messages you approved. Never the originals |
| The AI provider you configure | Each text sent to be rewritten, plus the topic and up to 6 recent approved messages as context. With `REWRITER=fake` nothing leaves your machine |
| Your hosting provider | Everything on the server's disk |
| A reverse proxy, if you use one | Every request in transit. The Caddy config that `setup_service.sh` writes has no access log switched on |
| Whoever runs the service | Can read stored messages in the database |

## How long, and how it is deleted

- Drafts are deleted when sent, cancelled, replaced, on close, or when they expire (1 hour). A cleanup job runs every 10 minutes.
- A conversation and everything inside it is deleted 30 days after it is closed, or 30 days after the last message (or after it was created, if there were none) when nobody closes it. This includes both count tables. `RETENTION_DAYS` changes the 30.
- Deleting removes the rows in SQLite. Disk level traces (the write ahead log, free pages, your own backups) are not wiped on purpose.
