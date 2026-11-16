# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [0.1.0-alpha] — 2026-11-16

First public alpha.

### Added
- Import ChatGPT, Claude and Gemini (Takeout) exports; Grok Bot JSONL; Claude Code / Codex local sessions; optional Chrome extension for chatgpt.com / claude.ai.
- Chat status classification (done · in progress · stalled · quick question) and conversation outcome (done · moved · interrupted · open) via LLM (Gemini, Claude, OpenAI, xAI, Ollama) or a free offline rule classifier.
- Projects → tasks grouping, merge suggestions, new-project suggestions, next step per task (manual edits are pinned).
- Graph home, task detail with conversation flow, daily digest, weekly review (rule-based, no LLM cost), review queue.
- Archive-only chat cleanup (export first, never deletes, never drives the browser).
- Layered TOC over HTTP and MCP: `toc_index` → `toc_project` → `toc_task` → `toc_conversation_excerpt`; optional write tools with undo.
- Shared editable Markdown memory folder with local git history and revert (`tools/memory/`).
- Ontology view (people, tools, decisions, files and their relations).
- English UI by default with Korean option (`?lang=ko`); English or Korean classification prompt (`SUBBRAIN_LANG`).
- One-command setup (`npm run setup`), demo mode with fictional sample data (`npm run demo`).
- English demo dataset (an indie developer's SaaS launch, novel, Rust learning, trip, newsletter, homelab and running plan across ChatGPT, Claude, Gemini, Grok and Claude Code), dated relative to today; the Korean dataset stays available with `--lang ko`.
- English/Korean server-generated text (`SUBBRAIN_LANG` / `--lang`): morning digest, next-step reasons, stalled labels, rule-classifier summaries, why-stalled explanations, TOC/MCP text, terminal messages.
- Screenshots of the main screens in `docs/screenshots/`.

### Known issues
- Obsidian vault notes, most non-TOC MCP tool descriptions, the ontology extraction prompt and the docs under `docs/` are still Korean.
- Times use the system time zone's UTC offset at startup (`SUBBRAIN_UTC_OFFSET` overrides); restart after a DST change.
- Timeline and time-rewind are placeholders; the cleanup deletion executor is off.
