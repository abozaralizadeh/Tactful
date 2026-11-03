# Contributing

Thanks for wanting to help. Tactful is source available and free for non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE).

## Your contribution and the license

Contributions are accepted only if you agree that Abozar Alizadeh may relicense them, commercially too. By opening a pull request you confirm that:

- you wrote the change yourself, or have the right to submit it, and
- you agree that it can be used, changed and distributed under the project's license, and that the project owner can later offer it under other licenses, including commercial ones.

If you don't agree, please don't send code. Issues, bug reports and ideas are welcome either way.

## Before you send a pull request

- Run `npm test` and `npm run typecheck`. Both should pass.
- Keep the product rules in [docs/DESIGN.md](docs/DESIGN.md) intact. If the rewrite fails nothing is sent, the sender approves every rewrite, originals are deleted once sent or dropped, and message text never goes into a log. Tests cover each one.
- Don't tune the fake rewriter to pass the 50 message test. The test is for real providers.
- Keep paid or outside services behind an interface with a local fake, like `server/rewriter/`.
- Never commit keys or `.env`.
- Keep changes small and say what you changed and why.

## Commercial use

Commercial use needs written permission. Ask by opening a GitHub issue.
