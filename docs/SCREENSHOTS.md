# Screenshot / demo-video shot list (placeholders)

Captured from `npm run demo` (fictional English data only) at 1280×800, dark theme. Never use real data.
Re-capture: `npm run demo`, then e.g. `google-chrome --headless=new --window-size=1280,800 --virtual-time-budget=10000 --screenshot=docs/screenshots/01-home-graph.png http://127.0.0.1:4545/`.

| File | Screen | What to show |
|---|---|---|
| ✅ `docs/screenshots/01-home-graph.png` | Graph home `/` | Project clusters, selected project panel with next step and "Continue in ChatGPT" |
| ✅ `docs/screenshots/02-tasks.png` | Tasks `/board` | Tasks by status with next steps, outcome badges (moved to Claude Code, interrupted) |
| ✅ `docs/screenshots/03-task-detail.png` | Task detail `/tasks/task_tp_pricing` | Why stalled, conversation flow, decisions, open questions, continue panel |
| ✅ `docs/screenshots/04-weekly-review.png` | Weekly review `/week` | Finished / started / stalled / long-idle |
| ✅ `docs/screenshots/05-todays-digest.png` | Today's digest `/digest` | Yesterday's summary, "Continue today" top 3 |
| `docs/screenshots/cleanup.png` | Digest → chat cleanup | Archive-only list, "no deletion" note |
| `docs/screenshots/mcp.png` | Claude Desktop | An agent calling `toc_index` → `toc_task` and continuing work |
| `docs/screenshots/memory.png` | Terminal | `memory-log.sh` / `memory-revert.sh` on the shared memory folder |
| `docs/demo.mp4` | 60–90 s video | Import → statuses appear → weekly review → agent continues via TOC |
