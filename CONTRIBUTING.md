# Contributing

Thanks for helping! Subbrain is an early alpha, so small focused PRs and good bug reports are the most valuable.

- **Setup:** Node 22.16+, then `npm run setup`. Run `pnpm test`, `pnpm --filter @subbrain/extension test` and `pnpm typecheck` before opening a PR.
- **Never commit real chats.** Tests and fixtures must use clearly fake data. If you report an import bug, anonymize the export sample first (names, emails, URLs, IDs).
- **No deletions by default.** Features that touch the user's data or source services must be reversible (archive / mark / undo), not destructive.
- **Costs:** anything that calls an LLM must show an estimate first and respect `llm.dailyCostCapUsd`.
- **UI strings:** wrap user-visible text in `tt("…")` / `ttf("… {0}", x)` from `web/src/i18n` and add the English text to `web/src/i18n/en.json`.
- **Design:** keep the Graphite dark look — near-black surfaces, no blue tint, no neon, glow or gradients, Pretendard font. Tokens live in `web/src/styles/tokens.css`.
- **API changes:** update `packages/shared/src/api-types.ts` and `scripts/contract.template.md`, then `pnpm contract`.

By contributing you agree that your contributions are licensed under the project's MIT license.
