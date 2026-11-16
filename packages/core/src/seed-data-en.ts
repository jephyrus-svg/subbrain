/**
 * English demo dataset — fully fictional. One indie developer juggling a SaaS launch, a novel, a trip,
 * learning Rust, a newsletter, a homelab and half-marathon training, across ChatGPT / Claude / Gemini / Grok / Claude Code.
 * Dates are relative to "today" (the day you seed), so the demo always looks fresh: active work was yesterday,
 * stalled work is days or weeks old, archived work fills the 26-week activity bars.
 * Any resemblance to real people, products or conversations is coincidental.
 */
import type { OntologyGraphResponse, SourceAi } from '@subbrain/shared';
import type { ArchivedDef, AutoTask, SeedDataset, TaskSpec } from './seed-data.ts';
import { tzOffsetMs, tzSuffix } from './util/time.ts';

export function buildEnDataset(today: string): SeedDataset {
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  /** n days ago at HH:MM → 'YYYY-MM-DD HH:MM' */
  const at = (n: number, hm: string) => `${day(n)} ${hm}`;
  const iso = (n: number, hms: string) => `${day(n)}T${hms}${tzSuffix()}`;
  /** a few minutes ago when seeding for the real today — keeps "this week" populated even on a Monday */
  const realToday = new Date(Date.now() + tzOffsetMs()).toISOString().slice(0, 10);
  const ago = (mins: number) => (today === realToday ? new Date(Date.now() + tzOffsetMs() - mins * 60_000).toISOString().slice(0, 16).replace('T', ' ') : at(0, '09:00'));

  const PROJECTS: SeedDataset['PROJECTS'] = [
    { id: 'prj_tidepool', name: 'Tidepool (SaaS)', color: '#F07F5E', aliases: ['Tidepool', 'invoicing app'], priority: 1.2,
      summary: 'Stripe billing works in test mode and webhooks are being hardened. The pricing page headline is stuck between two options; launch is pencilled in for next month.' },
    { id: 'prj_novel', name: 'Novel: The Salt Archive', color: '#D768A6', aliases: ['novel', 'The Salt Archive'], priority: 1.1,
      summary: 'First draft at 41k words. Chapter 7 (the lighthouse reveal) is outlined halfway; the tide-magic rules sheet is being cleaned up.' },
    { id: 'prj_rust', name: 'Learning Rust', color: '#4DB9E3', aliases: ['Rust', 'rustlang'],
      summary: 'Ownership and lifetimes finally clicked. Practising with a small CLI called tally; async/tokio is next.' },
    { id: 'prj_portugal', name: 'Portugal trip', color: '#36C2A6', aliases: ['Lisbon', 'Porto', 'trip'], thresholds: null,
      summary: 'Flights booked. Lisbon days are locked; stuck on Sintra vs Cascais for day 4, train to Porto still to book.' },
    { id: 'prj_newsletter', name: 'Dev newsletter', color: '#E8B63E', aliases: ['newsletter', 'Friday Diff'],
      summary: '312 subscribers. Issue #14 is drafted; the sponsor rate card is waiting on open-rate numbers.' },
    { id: 'prj_homelab', name: 'Homelab', color: '#A393E0', aliases: ['home server', 'Raspberry Pi'],
      summary: 'Backups and Tailscale are done. Home Assistant automations have been stalled for three weeks.' },
    { id: 'prj_running', name: 'Half-marathon training', color: '#9CCB5E', aliases: ['running', 'half marathon'],
      summary: 'Week 5 of a 12-week plan. Long runs are up to 14 km.' },
  ];

  const TOPICS: SeedDataset['TOPICS'] = [
    ['pricing', 'Pricing', ['pricing', 'plans']], ['copywriting', 'Copywriting', ['copy', 'headline']], ['payments', 'Payments', ['stripe', 'billing']],
    ['launch', 'Launch', ['show hn', 'launch']], ['worldbuilding', 'Worldbuilding', ['magic system', 'lore']], ['async', 'Async', ['tokio', 'futures']],
    ['itinerary', 'Itinerary', ['itinerary', 'day trip']], ['automation', 'Automation', ['automation', 'cron']],
  ];

  // conversation source ids that other records point at (conv id = conv_<ai>_<first 8 chars>)
  const SID = {
    tiers: 'b7e10a01-3c2d-4e5f-8a9b-0c1d2e3f4a51', ideas: 'c8f20b02-4d3e-8f60-9bac-1d2e3f4a5b62', ab: 'd9a30c03-5e4f-8071-acbd-2e3f4a5b6c73',
    hooks: 'e0b40d04-6f50-4182-bdce-3f4a5b6c7d84', hooksCc: 'f1c50e05-7061-4293-cedf-4a5b6c7d8e95', ch7: 'a2d60f06-8172-43a4-dfe0-5b6c7d8e9fa6',
    tally: 'b3e71007-9283-44b5-e0f1-6c7d8e9fa0b7', lisbonWx: '4e5f60718293a4b5', itin: 'c4f82108-a394-45c6-f102-7d8e9fa0b1c8',
  };

  const EXPLICIT: TaskSpec[] = [
    {
      id: 'task_tp_pricing', title: 'Finalize the pricing page headline', project: 'prj_tidepool', state: 'stall', conf: 0.86, topics: ['pricing', 'copywriting', 'launch'],
      summary: 'Narrowed 12 headline ideas down to A vs B. Agreed on a plain, no-hype tone.',
      detail: [
        'Flat pricing decided: $9 Solo / $19 Studio, 14-day trial, no free tier.',
        '12 headline ideas → 3 → A ("Send the invoice. Get paid. Get back to work.") vs B (a question).',
        'Leaning towards A but worried it is too plain — ended with “let me sleep on it”.',
      ],
      next: 'Write 3 sublines and 2 CTA buttons under headline A',
      convs: [
        { ai: 'claude', sid: SID.tiers, title: 'Pricing tiers: flat vs per-seat', from: at(24, '21:10'), to: at(24, '22:05'), n: 16,
          summary: 'Picked flat pricing — per-seat felt wrong for solo freelancers. $9 Solo, $19 Studio, 14-day trial.',
          msgs: { 1: ['user', "I'm building Tidepool, a tiny invoicing tool for freelancers. Flat pricing or per-seat?"],
            8: ['assistant', 'Per-seat punishes your best customers — freelancers who bring a bookkeeper. Flat tiers keyed to *features* (recurring invoices, multi-currency) age better.'],
            15: ['user', 'Ok, flat it is. $9 Solo, $19 Studio. No free tier, 14-day trial.'] } },
        { ai: 'chatgpt', sid: SID.ideas, title: 'Pricing page headline ideas', from: at(16, '20:40'), to: at(16, '22:02'), n: 26,
          summary: '12 ideas → 3. Rule: no "revolutionize", write it like a person. One headline + one subline.',
          msgs: { 1: ['user', 'Give me 12+ headline ideas for the pricing page of a small invoicing SaaS for freelancers.'],
            9: ['user', 'Drop anything with "revolutionize", "supercharge" or "effortless". Write it like an actual human.'],
            10: ['assistant', 'Shortlist — ① Send the invoice. Get paid. Get back to work. ② Why does invoicing still take an afternoon? ③ Invoices that don’t need a second look.'],
            25: ['user', 'Structure: one headline + one subline. CTA is either "Start free trial" or "See a sample invoice" — not sure yet.'] } },
        { ai: 'chatgpt', sid: SID.ab, title: 'Headline A vs B', from: at(10, '23:05'), to: at(9, '00:47'), n: 18,
          summary: 'Compared A (plain statement) and B (question). Leaning A, but no decision.', evidence: 'Ended with “let me sleep on it”',
          msgs: { 1: ['user', 'Compare these side by side.\n\nA: Send the invoice. Get paid. Get back to work.\nB: Why does invoicing still take an afternoon?'],
            2: ['assistant', '| | A | B |\n|---|---|---|\n| First read | calm, confident | curious |\n| Sounds like you | high | medium |\n| Risk | a bit plain | sounds like an ad |'],
            15: ['user', 'Ok, down to A and B. Is A too plain though?'],
            16: ['assistant', 'Keep A and put *one concrete number* in the subline. e.g. “Most invoices go out in under 90 seconds.”'],
            17: ['user', 'A sounds more like me, but is it too plain? Let me sleep on it.'],
            18: ['assistant', 'Sounds good. Next time, start from A and we’ll write the subline together.'] } },
      ],
    },
    { id: 'task_tp_webhooks', title: 'Make Stripe webhooks idempotent', project: 'prj_tidepool', state: 'run', conf: 0.9, topics: ['payments'],
      summary: 'Duplicate invoice.paid events created double receipts. Fix: a processed_events table keyed by Stripe event id.',
      detail: ['Root cause: Stripe retries on slow 200s, and the handler was not idempotent.', 'Plan written to plan.md in Claude, implemented in Claude Code; unit tests pass.'],
      next: 'Replay the last 24h of Stripe events against staging (stripe events resend)',
      convs: [
        { ai: 'claude', sid: SID.hooks, title: 'Stripe sends invoice.paid twice', from: at(4, '21:30'), to: at(3, '00:10'), n: 20,
          msgs: { 1: ['user', 'Stripe is sending invoice.paid twice and we create two receipts. How do I make the handler idempotent?'],
            12: ['assistant', 'Store `event.id` in a `processed_events` table with a UNIQUE constraint and wrap the handler in one transaction. Duplicates just return 200.'],
            19: ['user', "Write the plan up as markdown — I'll continue in Claude Code."] } },
        { ai: 'claude-code', sid: SID.hooksCc, title: 'tidepool: idempotent webhook handler', from: at(2, '20:15'), to: at(1, '23:40'), n: 34,
          msgs: { 1: ['user', 'Implement the processed_events table and idempotency check from plan.md. Add tests for duplicate deliveries.'],
            33: ['user', 'Tests pass locally. Next: replay the last 24h of events from the Stripe CLI against staging.'] } },
      ] },
    { id: 'task_tp_landing', title: 'Landing page hero section', project: 'prj_tidepool', state: 'done', conf: 0.92, topics: ['copywriting', 'launch'],
      summary: 'Single-column hero with a real invoice screenshot instead of an illustration.',
      convs: [
        { ai: 'gemini', title: 'Hero section references', from: at(38, '19:30'), to: at(38, '20:40'), n: 8 },
        { ai: 'chatgpt', title: 'Hero copy and screenshot', from: at(31, '21:00'), to: at(30, '22:10'), n: 12, sharedWith: 'task_tp_pricing',
          summary: 'Decided to show a real invoice screenshot. Headline length: keep under 8 words — reused for the pricing page.' },
      ] },
    { id: 'task_tp_name', title: 'Product name & domain', project: 'prj_tidepool', state: 'done', conf: 0.93,
      summary: '“Tidepool” won over “Ledgerly” and “Billfold”. Bought the .app domain.',
      convs: [{ ai: 'grok', title: 'Name ideas for an invoicing app', from: at(62, '22:00'), to: at(61, '00:30'), n: 22 }] },
    // novel
    { id: 'task_novel_ch7', title: 'Chapter 7 outline — the lighthouse reveal', project: 'prj_novel', state: 'stall', conf: 0.84, topics: ['worldbuilding'],
      summary: 'Two options for the reveal: Ines finds the ledger herself, or the keeper confesses. Leaning towards the ledger.',
      next: 'Outline ch. 7 beats with the ledger version and check them against the ch. 3 foreshadowing',
      convs: [
        { ai: 'claude', sid: SID.ch7, title: 'Chapter 7: where should the reveal happen?', from: at(12, '22:10'), to: at(12, '23:55'), n: 22,
          msgs: { 1: ['user', 'In my novel, the lighthouse keeper has been forging the tide ledger for 20 years. Should Ines discover it, or should he confess?'],
            10: ['assistant', 'If she *finds* it, the reader gets to be a step ahead of the keeper. If he *confesses*, you get a quieter, sadder scene. The ledger option pays off the ink stain you planted in chapter 3.'],
            21: ['user', 'Ledger it is, probably. I need to reread ch. 3 first.'] } },
        { ai: 'gemini', title: 'Foreshadowing audit, chapters 1–6', from: at(6, '21:00'), to: at(6, '22:20'), n: 14 },
      ] },
    { id: 'task_novel_magic', title: 'Tide-magic consistency check', project: 'prj_novel', state: 'run', conf: 0.88, topics: ['worldbuilding'],
      summary: 'Built a one-page rules sheet for the tide magic and found 3 contradictions (ch. 2 and ch. 5).',
      next: 'Fix the ch. 5 scene where magic works at low tide',
      convs: [
        { ai: 'claude', title: 'Rules sheet for the tide magic', from: at(5, '20:00'), to: at(5, '21:30'), n: 16 },
        { ai: 'grok', title: 'Find contradictions in my magic system', from: at(2, '22:00'), to: at(2, '23:10'), n: 12,
          msgs: { 1: ['user', 'Here is my rules sheet and chapters 2 and 5. Find every place where the magic breaks its own rules.'],
            2: ['assistant', 'Three breaks: (1) ch. 2 — Ines lifts water *inland*, but the sheet says salt water only. (2) ch. 5 — a spell works at low tide. (3) ch. 5 — the keeper ages backwards for a page, which nothing explains.'] } },
      ] },
    // rust
    { id: 'task_rust_tally', title: 'Build the `tally` CLI in Rust', project: 'prj_rust', state: 'run', conf: 0.9,
      summary: 'Subcommands add/list/done work. Fought the borrow checker over mutating a Vec while iterating it.',
      next: 'Add `tally export --csv` with the csv crate',
      convs: [
        { ai: 'chatgpt', sid: SID.tally, title: 'Borrow checker: cannot borrow as mutable', from: at(3, '21:00'), to: at(3, '22:30'), n: 14,
          msgs: { 1: ['user', 'Why does the borrow checker hate me?\n\nerror[E0502]: cannot borrow `self.items` as mutable because it is also borrowed as immutable'],
            2: ['assistant', 'You are holding an iterator over `self.items` while pushing to it. Collect what you need first, then mutate — or use `retain()` / `iter_mut()` depending on intent.'],
            13: ['user', 'retain() fixed it and the code is shorter. Rust is weirdly satisfying.'] } },
        { ai: 'claude', title: 'tally: clap subcommands', from: at(1, '20:30'), to: at(1, '22:05'), n: 12 },
      ] },
    { id: 'task_rust_lifetimes', title: 'Understand lifetimes (Rust book ch. 10)', project: 'prj_rust', state: 'done', conf: 0.94,
      summary: 'Key insight: lifetime annotations describe relationships, they never extend a value’s life.',
      convs: [
        { ai: 'claude', title: 'Lifetimes, explained slowly', from: at(15, '21:00'), to: at(14, '22:20'), n: 18,
          msgs: { 16: ['assistant', 'Think of `\'a` as a promise you make to the compiler: “the output lives no longer than the shortest input”. You’re describing, not extending.'],
            17: ['user', 'Oh. It clicked. Annotations describe, they don’t extend. Thanks!'] } },
      ] },
    // trip
    { id: 'task_trip_itinerary', title: 'Lisbon + Porto 6-day itinerary', project: 'prj_portugal', state: 'stall', conf: 0.83, topics: ['itinerary'],
      summary: 'Days 1–3 in Lisbon are locked (Alfama, Belém, LX Factory). Stuck on day 4: Sintra or Cascais.',
      next: 'Pick Sintra or Cascais for day 4, then book the train',
      convs: [{ ai: 'gemini', sid: SID.itin, title: 'Lisbon + Porto in 6 days', from: at(13, '20:30'), to: at(8, '22:40'), n: 24,
        msgs: { 1: ['user', '6 days in Portugal in late autumn, first time. Lisbon + Porto. I like food, bookshops and walking, not museums all day.'],
          14: ['assistant', 'Day 4 is the fork: Sintra = palaces and fog, crowded; Cascais = coast walk and seafood, relaxed. Both are ~40 min by train.'],
          23: ['user', 'Can’t decide on Sintra vs Cascais. Let me ask my partner and come back.'] } }] },
    // homelab
    { id: 'task_ha_lights', title: 'Home Assistant: lights follow sunset', project: 'prj_homelab', state: 'stall', conf: 0.8, topics: ['automation'],
      summary: 'Sunset trigger works; the hallway Zigbee bulb keeps dropping off the network.',
      next: 'Move the Zigbee coordinator off the USB 3 port (interference) and re-pair the hallway bulb',
      convs: [{ ai: 'chatgpt', title: 'Zigbee bulb keeps going unavailable', from: at(24, '21:00'), to: at(22, '22:10'), n: 16 }] },
  ];

  const AUTO: AutoTask[] = [
    // today
    { id: 'task_rust_tests', title: 'tally: integration tests with assert_cmd', project: 'prj_rust', state: 'done', ai: 'claude-code', msgs: 12, first: ago(170), last: ago(95),
      summary: 'Added assert_cmd + tempfile tests for add/list/done; CI runs them on every push.' },
    { id: 'task_tp_launchdate', title: 'Pick a launch date', project: 'prj_tidepool', state: 'run', ai: 'chatgpt', msgs: 8, first: ago(60), last: ago(25), topics: ['launch'],
      summary: 'Tuesday or Wednesday morning US time looks best; avoid big conference weeks.', next: 'Put the launch on the calendar and tell the two beta users' },
    // tidepool
    { id: 'task_tp_onboarding', title: 'Onboarding email sequence', project: 'prj_tidepool', state: 'stall', ai: 'chatgpt', msgs: 24, first: at(15, '20:00'), last: at(7, '22:30'), topics: ['copywriting'],
      summary: 'Email 1 (welcome) written. Waiting for the pricing headline so emails 2–4 share its voice.', next: 'Write email 2 (day 3): “Send your first invoice in 90 seconds”' },
    { id: 'task_tp_showhn', title: 'Show HN post draft', project: 'prj_tidepool', state: 'run', ai: 'claude', msgs: 16, first: at(3, '19:30'), last: at(2, '21:40'), topics: ['launch'],
      summary: 'Draft title: “Show HN: Tidepool – invoicing for freelancers, no per-seat pricing”. Body under 200 words, no superlatives.', next: 'Ask two friends to read the draft cold and note the first question they ask' },
    { id: 'task_tp_launchthread', title: 'Launch announcement thread', project: 'prj_tidepool', state: 'run', ai: 'grok', msgs: 10, first: at(2, '22:30'), last: at(2, '23:20'), topics: ['launch'],
      summary: 'Five-post thread: problem → demo gif → pricing → stack → ask for feedback.', next: 'Record the 15-second demo gif' },
    { id: 'task_tp_pdf', title: 'Fast PDF invoice rendering', project: 'prj_tidepool', state: 'done', ai: 'claude', msgs: 26, first: at(26, '20:00'), last: at(20, '22:30'),
      summary: 'Switched from headless Chrome to Typst: ~40× faster, no Chrome in production.' },
    { id: 'task_tp_db', title: 'SQLite or Postgres for v1?', project: 'prj_tidepool', state: 'done', ai: 'claude', msgs: 18, first: at(48, '21:00'), last: at(45, '22:00'),
      summary: 'SQLite + Litestream backups to S3. Revisit at ~1,000 customers.' },
    { id: 'task_tp_vat', title: 'EU VAT for B2B customers', project: 'prj_tidepool', state: 'stall', ai: 'gemini', msgs: 14, first: at(16, '20:00'), last: at(13, '21:30'), topics: ['payments'],
      summary: 'Reverse charge applies to EU business customers; unclear whether Stripe Tax handles it for a non-EU seller.', next: 'Check whether Stripe Tax covers reverse charge, or ask an accountant' },
    // novel
    { id: 'task_novel_bible', title: 'Character bible: Ines and the keeper', project: 'prj_novel', state: 'done', ai: 'claude', msgs: 30, first: at(40, '21:00'), last: at(35, '23:00'),
      summary: 'One page per character: want, fear, secret, verbal tic.' },
    { id: 'task_novel_query', title: 'Query letter for literary agents', project: 'prj_novel', state: 'stall', ai: 'chatgpt', msgs: 20, first: at(34, '21:00'), last: at(28, '22:30'),
      summary: 'Draft is 410 words — agents want ~250. Comp titles still missing.', next: 'Cut the query to 250 words and pick two comp titles' },
    { id: 'task_novel_storm', title: 'Chapter 9: the shipwreck scene', project: 'prj_novel', state: 'stall', ai: 'gemini', msgs: 12, first: at(6, '23:00'), last: at(5, '00:40'), conf: 0.55,
      summary: 'Rewrote the shipwreck from the drowning sailor’s point of view. Needs a gentler ending.', next: 'Decide whether the sailor survives' },
    // rust
    { id: 'task_rust_async', title: 'Async Rust with tokio', project: 'prj_rust', state: 'stall', ai: 'chatgpt', msgs: 18, first: at(14, '21:00'), last: at(11, '22:00'), topics: ['async'],
      summary: 'Understood futures are lazy. Stuck on why a spawned task needs \'static data.', next: 'Finish the tokio tutorial: spawning + JoinHandle' },
    { id: 'task_rust_errors', title: 'Errors: anyhow vs thiserror', project: 'prj_rust', state: 'done', ai: 'claude', msgs: 12, first: at(5, '21:00'), last: at(4, '21:40'),
      summary: 'thiserror for library code, anyhow in main.rs.' },
    // trip
    { id: 'task_trip_trains', title: 'Lisbon → Porto train tickets', project: 'prj_portugal', state: 'run', ai: 'chatgpt', msgs: 10, first: at(2, '12:30'), last: at(2, '13:10'), topics: ['itinerary'],
      summary: 'Alfa Pendular (2h50) vs Intercidades (3h15). Tickets open 60 days ahead; early fares are much cheaper.', next: 'Book the morning Alfa Pendular on day 4' },
    { id: 'task_trip_packing', title: 'Carry-on only packing list', project: 'prj_portugal', state: 'done', ai: 'gemini', msgs: 10, first: at(3, '08:00'), last: at(3, '08:40'),
      summary: 'Fits in a 30 L bag. Rain jacket + one pair of shoes that survive cobblestones.' },
    { id: 'task_trip_food', title: 'Where to eat in Porto', project: 'prj_portugal', state: 'run', ai: 'grok', msgs: 8, first: at(1, '12:10'), last: at(1, '12:50'), topics: ['itinerary'],
      summary: 'Shortlist of 6 places; francesinha is mandatory at least once.', next: 'Book a table for the first night in Porto' },
    // newsletter
    { id: 'task_nl_issue14', title: 'Issue #14: “Boring tech that saved me”', project: 'prj_newsletter', state: 'run', ai: 'claude', msgs: 14, first: at(2, '20:00'), last: at(1, '21:30'),
      summary: 'Five short stories: SQLite, cron, Makefiles, plain HTML email, Typst.', next: 'Trim the cron section and schedule for Friday 08:00' },
    { id: 'task_nl_ratecard', title: 'Sponsor rate card', project: 'prj_newsletter', state: 'stall', ai: 'chatgpt', msgs: 12, first: at(12, '21:00'), last: at(10, '21:40'),
      summary: 'Draft price $120 per issue. Missing open-rate numbers to justify it.', next: 'Export open rates for the last 8 issues' },
    { id: 'task_nl_migrate', title: 'Move the newsletter off Substack', project: 'prj_newsletter', state: 'done', ai: 'chatgpt', msgs: 16, first: at(44, '21:00'), last: at(40, '22:00'),
      summary: 'Moved to Buttondown; subscribers imported, custom domain set up.' },
    // homelab
    { id: 'task_hl_backups', title: 'Restic backups to Backblaze B2', project: 'prj_homelab', state: 'done', ai: 'claude', msgs: 20, first: at(29, '20:00'), last: at(26, '22:00'), topics: ['automation'],
      summary: 'Nightly restic backups, 30-day retention, monthly restore test.' },
    { id: 'task_hl_tailscale', title: 'Tailscale on the Raspberry Pi', project: 'prj_homelab', state: 'done', ai: 'chatgpt', msgs: 8, first: at(33, '21:00'), last: at(33, '21:50'),
      summary: 'Pi reachable from the laptop anywhere; SSH over the tailnet only.' },
    // running
    { id: 'task_run_plan', title: '12-week half-marathon plan', project: 'prj_running', state: 'run', ai: 'gemini', msgs: 22, first: at(34, '07:30'), last: at(1, '07:10'),
      summary: 'Three runs a week: intervals, easy, long. Week 5 of 12.', next: 'Saturday: 14 km long run at an easy pace' },
    { id: 'task_run_knee', title: 'Knee pain after long runs', project: 'prj_running', state: 'done', ai: 'claude', msgs: 10, first: at(19, '21:00'), last: at(18, '21:30'),
      summary: 'Probably too many kilometres too fast. Added strength work twice a week.' },
    // no project
    { id: 'task_misc_sourdough', title: 'Rescue my sourdough starter', project: null, state: 'done', ai: 'grok', msgs: 10, first: at(20, '09:00'), last: at(19, '09:30'),
      summary: 'Two feedings a day at a 1:1:1 ratio brought it back in three days.' },
    { id: 'task_misc_lease', title: 'Apartment lease renewal', project: null, state: 'run', ai: 'chatgpt', msgs: 12, first: at(3, '20:00'), last: at(2, '20:40'),
      summary: 'Landlord proposed +8%. Comparing against two listings nearby before replying.', next: 'Reply to the landlord with the two comparable listings' },
    { id: 'task_misc_desk', title: 'Choosing a standing desk', project: null, state: 'stall', ai: 'chatgpt', msgs: 10, first: at(14, '21:00'), last: at(12, '21:30'),
      summary: 'Down to two frames; undecided on the desktop size.', next: 'Measure the alcove — 140 cm or 160 cm top?' },
  ];

  const QUICK: SeedDataset['QUICK'] = [
    ['Stripe test card numbers', 'prj_tidepool', 'chatgpt', at(3, '11:05')], ['Tailwind container queries', 'prj_tidepool', 'claude', at(6, '14:10')],
    ['Litestream restore command', 'prj_tidepool', 'claude', at(9, '22:30')], ['og:image recommended size', 'prj_tidepool', 'chatgpt', at(17, '16:40')],
    ['What does ? do in Rust', 'prj_rust', 'claude', at(4, '22:40')], ['Box vs Rc vs Arc', 'prj_rust', 'chatgpt', at(8, '21:20')], ['cargo clippy pedantic', 'prj_rust', 'claude', at(13, '20:10')],
    ['Lisbon weather in late autumn', 'prj_portugal', 'gemini', at(9, '08:10')], ['Do I need cash in Lisbon', 'prj_portugal', 'grok', at(7, '12:30')], ['Pastéis de nata: Belém or Manteigaria', 'prj_portugal', 'chatgpt', at(5, '22:20')],
    ['Synonyms for brine', 'prj_novel', 'claude', at(4, '23:30')], ['Em dash vs en dash', 'prj_novel', 'chatgpt', at(11, '10:00')],
    ['Best send time for a dev newsletter', 'prj_newsletter', 'grok', at(6, '19:40')],
    ['Raspberry Pi 5 power supply', 'prj_homelab', 'gemini', at(21, '19:40')],
    ['Electrolytes on a 15 km run', 'prj_running', 'gemini', at(2, '07:50')],
    ['Regex for email validation', null, 'chatgpt', at(1, '10:02'), 0.48], ['USD to EUR today', null, 'grok', ago(45)], ['Mac screenshot to clipboard', null, 'gemini', at(4, '10:00')],
    ['HTTP 422 vs 400', null, 'claude', at(10, '11:20')], ['Convert HEIC to JPG on a Mac', null, 'chatgpt', at(16, '09:30')],
  ];

  const ARCHIVED: SeedDataset['ARCHIVED_BLOG'] = [
    { id: 'task_tp_competitors', title: 'Competitor teardown: big invoicing suites', convs: [['chatgpt', at(70, '20:00'), at(70, '21:00'), 10], ['chatgpt', at(68, '20:00'), at(68, '20:40'), 10], ['chatgpt', at(66, '21:00'), at(66, '21:30'), 8]] },
    { id: 'task_tp_interviews', title: 'Freelancer interview questions', convs: [['claude', at(64, '21:00'), at(64, '21:40'), 12], ['claude', at(60, '20:00'), at(60, '20:30'), 8]] },
  ];
  const OLD: ArchivedDef[] = [
    { id: 'task_old_idea', title: 'Validate the invoicing app idea', project: 'prj_tidepool', ai: 'chatgpt', convs: 6, msgs: 60, from: at(120, '21:00'), to: at(100, '22:00') },
    { id: 'task_old_draft', title: 'Novel: first three chapters', project: 'prj_novel', ai: 'claude', convs: 8, msgs: 96, from: at(150, '21:00'), to: at(110, '23:00') },
    { id: 'task_old_rustbook', title: 'Rust book, chapters 1–6', project: 'prj_rust', ai: 'claude', convs: 6, msgs: 66, from: at(90, '21:00'), to: at(60, '22:00') },
    { id: 'task_old_go', title: 'Go basics (abandoned for Rust)', project: null, ai: 'chatgpt', convs: 5, msgs: 50, from: at(175, '21:00'), to: at(160, '22:00') },
    { id: 'task_old_keyboard', title: 'Build a mechanical keyboard', project: null, ai: 'grok', convs: 5, msgs: 40, from: at(165, '20:00'), to: at(150, '21:00') },
    { id: 'task_old_notes', title: 'Notion vs Obsidian', project: null, ai: 'gemini', convs: 4, msgs: 36, from: at(145, '21:00'), to: at(135, '22:00') },
    { id: 'task_old_speech', title: 'Best-man speech for my brother', project: null, ai: 'claude', convs: 5, msgs: 50, from: at(130, '22:00'), to: at(118, '23:00') },
    { id: 'task_old_taxes', title: 'Freelance taxes: home office deduction', project: null, ai: 'chatgpt', convs: 4, msgs: 40, from: at(105, '20:00'), to: at(95, '21:00') },
    { id: 'task_old_spanish', title: 'Spanish phrases for travel', project: null, ai: 'gemini', convs: 5, msgs: 45, from: at(85, '08:00'), to: at(70, '08:30') },
    { id: 'task_old_pihole', title: 'Pi-hole setup', project: 'prj_homelab', ai: 'chatgpt', convs: 4, msgs: 36, from: at(80, '21:00'), to: at(72, '22:00') },
    { id: 'task_old_5k', title: 'Couch to 5K', project: 'prj_running', ai: 'gemini', convs: 5, msgs: 40, from: at(100, '07:00'), to: at(56, '07:30') },
  ];

  const conv = (ai: SourceAi, sid: string) => `conv_${ai}_${sid.replace(/[^0-9a-z]/gi, '').toLowerCase().slice(0, 8)}`;
  const DECISIONS: SeedDataset['DECISIONS'] = [
    ['obj_decision_en01', 'task_tp_pricing', 'Flat pricing: $9 Solo / $19 Studio, 14-day trial, no free tier', conv('claude', SID.tiers), 'claude', at(24, '21:58')],
    ['obj_decision_en02', 'task_tp_pricing', 'One headline + one subline on the pricing page', conv('chatgpt', SID.ideas), 'chatgpt', at(16, '21:55')],
    ['obj_decision_en03', 'task_tp_pricing', 'No hype words (“revolutionize”, “supercharge”, “effortless”)', conv('chatgpt', SID.ideas), 'chatgpt', at(16, '21:12')],
    ['obj_decision_en04', 'task_tp_webhooks', 'Deduplicate webhooks with a processed_events table keyed by event id', conv('claude', SID.hooks), 'claude', at(3, '23:40')],
    ['obj_decision_en05', 'task_novel_ch7', 'Ines discovers the forged ledger herself (no confession)', conv('claude', SID.ch7), 'claude', at(12, '23:50')],
  ];
  const OPEN_QUESTIONS = [
    { id: 'oq_tp_pricing_1', text: 'Is headline A too plain? Add a concrete number to the subline?', resolved: false, note: 'End of the “Headline A vs B” chat', sourceConversationId: conv('chatgpt', SID.ab), resolvedAt: null },
    { id: 'oq_tp_pricing_2', text: 'CTA: “Start free trial” or “See a sample invoice”?', resolved: false, note: 'Raised once, never settled', sourceConversationId: conv('chatgpt', SID.ideas), resolvedAt: null },
    { id: 'oq_tp_pricing_3', text: 'Show annual pricing (2 months free) at launch?', resolved: false, note: 'Mentioned in the pricing-tiers chat', sourceConversationId: conv('claude', SID.tiers), resolvedAt: null },
  ];
  const RESUME = [
    '[Context] Tidepool — invoicing SaaS for freelancers. Choosing the pricing page headline.',
    'Decided: flat pricing ($9 Solo / $19 Studio, 14-day trial) / one headline + one subline / no hype words',
    'Option A: “Send the invoice. Get paid. Get back to work.”',
    'Option B: “Why does invoicing still take an afternoon?”',
    'Open: is A too plain — add a number to the subline? / CTA: “Start free trial” or “See a sample invoice”?',
    'Ask: starting from A, suggest 3 sublines and 2 CTA buttons.',
  ].join('\n');

  return {
    lang: 'en', PROJECTS, TOPICS, EXPLICIT, AUTO, QUICK, archivedProject: 'prj_tidepool', ARCHIVED_BLOG: ARCHIVED, PROJECT_TOTALS: {}, FILLERS: [], OLD_ARCHIVED: OLD,
    DECISIONS, COPY_OPEN_QUESTIONS: OPEN_QUESTIONS, COPY_RESUME_PROMPT: RESUME,
    quickSids: { 'Lisbon weather in late autumn': SID.lisbonWx },
    text: {
      suffix: ['', ' — continued', ' — second look', ' — summary', ' — wrap-up', ' — check', ' — follow-up', ' — notes'],
      U: [
        (t) => `Can you help me think through "${t}"?`, () => 'I didn’t quite get the second point.', (t) => `Ok. What’s the very first step for "${t}"?`,
        () => 'Shorter please, as a list.', () => 'Give me one more example.', () => 'That direction feels right. Next step.',
      ],
      A: [
        (t) => `For "${t}" I’d split it into three parts: 1) define the goal 2) compare the options 3) write down the decision.`,
        () => 'The second point is a filter: “do I need this right now?” If not, it goes on the later list.',
        (t) => `First step for "${t}": write the current state in one line, then pick the single thing that’s blocking you.`,
        () => '- One-line summary\n- Two options\n- One next action', () => 'For example: pick something you can finish in 30 minutes today.', () => 'Great — I’ll keep a short note of what we decided.',
      ],
      quickQ: (t) => `${t}?`, quickA: (t) => `Short answer on "${t}": the most common approach, plus one gotcha to watch for.`,
      resolved: 'That fixed it, thanks!', unresolved: 'Let’s stop here, I’ll come back to this later.',
      archivedSummary: (t) => `${t} — archived`, quickSummary: (t) => `${t} — one question, one answer`, convSummary: (t) => `Chat: ${t}`,
      evDone: 'Ended with “that fixed it”', evQuick: 'One question, one answer', evOpen: 'Last user message: “I’ll come back to this later”',
      sampleNote: 'Sample data', doneLabel: 'Done',
    },
    extras: {
      sensitiveKeywords: ['salary', 'medical'], sensitiveProjectIds: ['prj_running'],
      copyTaskId: 'task_tp_pricing', copyResumeAt: iso(9, '00:52:30'),
      taskLinks: [
        { src: 'task_tp_onboarding', dst: 'task_tp_pricing', type: 'derived_from', conf: 0.86, reason: 'Emails 2–4 reuse the pricing page voice — waiting for the headline', at: at(7, '22:35') },
        { src: 'task_tp_showhn', dst: 'task_tp_pricing', type: 'related_to', conf: 0.78, reason: 'The Show HN post quotes the pricing headline', at: at(2, '21:45') },
      ],
      projectLinks: [
        { a: 'prj_tidepool', b: 'prj_newsletter', reason: 'Launch will be announced in issue #15 · shared topic #launch', topics: ['obj_topic_launch'], w: 2 },
        { a: 'prj_tidepool', b: 'prj_rust', reason: 'Considering a Rust rewrite of the PDF renderer', topics: [], w: 1 },
        { a: 'prj_novel', b: 'prj_portugal', reason: 'Chapter 7 is set in a Porto bookshop — research on the trip', topics: ['obj_topic_itinerary'], w: 1.5 },
      ],
      mergeSuggestions: [{ id: 'ms_en01', a: 'task_tp_showhn', b: 'task_tp_launchthread', primary: 'task_tp_showhn', conf: 0.74,
        reason: 'Shared topic #launch · the same launch announcement drafted in Claude and continued in Grok', at: at(2, '23:30') }],
      handoff: { taskId: 'task_tp_webhooks', label: 'Continued in Claude Code', target: 'Claude Code', evidence: 'Last user message: “Write the plan up as markdown — I’ll continue in Claude Code.”' },
      interrupted: { evidence: 'Last user message: “Hit the usage limit — dump a summary to markdown so I can pick this up tomorrow”', reason: 'Usage limit' },
      blocked: { taskId: 'task_novel_storm', evidence: 'The provider declined to classify this chat (PROHIBITED_CONTENT) — filled in by the rule classifier instead' },
      projectSuggestion: { taskId: 'task_misc_lease', name: 'Apartment & lease', alt: ['Lease renewal'], at: at(2, '20:45') },
      vaultConflict: { taskId: 'task_tp_webhooks', note: '(Note typed directly in Obsidian: ask on the Stripe Discord about retry timing)' },
    },
    times: {
      projectCreated: at(180, '09:00'), capturedAt: at(1, '23:50'), importDay: day(1), importId: `imp_${day(1).replace(/-/g, '')}_demo`,
      importCreated: iso(1, '23:41:10'), importStarted: iso(1, '23:42:31'), importFinished: iso(1, '23:49:07'), syncChatgpt: iso(1, '23:50:12'), syncClaude: iso(1, '23:45:03'),
      digestDays: [day(2), day(1), day(0)], digestAt: '07:00:03', archiveCap: day(2),
    },
    ontology: buildOntology(at, iso),
  };
}

// ───────── relations graph (people, tools, places, decisions …)
type Obj = OntologyGraphResponse['objects'][number];
type Link = OntologyGraphResponse['links'][number];
function buildOntology(at: (n: number, hm: string) => string, iso: (n: number, hms: string) => string): OntologyGraphResponse {
  const ts = (n: number) => iso(n, '12:00:00');
  const objects: Obj[] = [];
  const links: Link[] = [];
  const ev = (title: string, ai: SourceAi, excerpt: string, n: number) => ({ id: 0, conversationId: '', sourceAi: ai, conversationTitle: title, messageSeq: null, excerpt, at: ts(n), confidence: null, model: null });
  const o = (id: string, type: Obj['type'], name: string, first: number, last: number, extra: Partial<Obj> = {}) => objects.push({
    id, type, name, aliases: [], status: 'accepted', confidence: 0.9, origin: 'llm', firstSeenAt: ts(first), lastSeenAt: ts(last), mentionCount: 3, properties: {},
    ref: null, projectObjectId: null, colorHex: null, statusVisual: null, badge: null, mergedInto: null, evidencePreview: [], ...extra,
  } as Obj);
  const P = (key: string, prj: string, name: string, color: string, first: number, mentions: number) =>
    o(`obj_project_${key}`, 'project', name, first, 1, { origin: 'rule', ref: { table: 'projects', id: prj }, colorHex: color, mentionCount: mentions });
  P('tidepool', 'prj_tidepool', 'Tidepool (SaaS)', '#F07F5E', 120, 64); P('novel', 'prj_novel', 'Novel: The Salt Archive', '#D768A6', 150, 41);
  P('rust', 'prj_rust', 'Learning Rust', '#4DB9E3', 90, 33); P('portugal', 'prj_portugal', 'Portugal trip', '#36C2A6', 15, 18);
  P('newsletter', 'prj_newsletter', 'Dev newsletter', '#E8B63E', 44, 15); P('homelab', 'prj_homelab', 'Homelab', '#A393E0', 80, 14); P('running', 'prj_running', 'Half-marathon training', '#9CCB5E', 100, 12);
  const T = (key: string, task: string, name: string, prj: string, first: number, last: number, vis: string | null, badge: string | null, evs: Obj['evidencePreview'] = []) =>
    o(`obj_task_${key}`, 'task', name, first, last, { origin: 'rule', ref: { table: 'tasks', id: task }, projectObjectId: `obj_project_${prj}`, statusVisual: vis as Obj['statusVisual'], badge, evidencePreview: evs });
  T('pricing', 'task_tp_pricing', 'Finalize the pricing page headline', 'tidepool', 24, 9, 'stall', '9d', [ev('Headline A vs B', 'chatgpt', 'A sounds more like me, but is it too plain? Let me sleep on it.', 9)]);
  T('webhooks', 'task_tp_webhooks', 'Make Stripe webhooks idempotent', 'tidepool', 4, 1, 'run', null, [ev('Stripe sends invoice.paid twice', 'claude', 'Stripe is sending invoice.paid twice and we create two receipts.', 4)]);
  T('onboarding', 'task_tp_onboarding', 'Onboarding email sequence', 'tidepool', 15, 7, 'stall', '7d');
  T('showhn', 'task_tp_showhn', 'Show HN post draft', 'tidepool', 3, 2, 'run', null);
  T('vat', 'task_tp_vat', 'EU VAT for B2B customers', 'tidepool', 16, 13, 'stall', '13d');
  T('pdf', 'task_tp_pdf', 'Fast PDF invoice rendering', 'tidepool', 26, 20, 'done', null);
  T('ch7', 'task_novel_ch7', 'Chapter 7 outline — the lighthouse reveal', 'novel', 12, 6, 'stall', '6d', [ev('Chapter 7: where should the reveal happen?', 'claude', 'Ledger it is, probably. I need to reread ch. 3 first.', 12)]);
  T('magic', 'task_novel_magic', 'Tide-magic consistency check', 'novel', 5, 2, 'run', null);
  T('tally', 'task_rust_tally', 'Build the `tally` CLI in Rust', 'rust', 3, 1, 'run', null);
  T('async', 'task_rust_async', 'Async Rust with tokio', 'rust', 14, 11, 'stall', '11d');
  T('itinerary', 'task_trip_itinerary', 'Lisbon + Porto 6-day itinerary', 'portugal', 13, 8, 'stall', '8d');
  T('trains', 'task_trip_trains', 'Lisbon → Porto train tickets', 'portugal', 2, 2, 'run', null);
  T('issue14', 'task_nl_issue14', 'Issue #14: “Boring tech that saved me”', 'newsletter', 2, 1, 'run', null);
  T('ha', 'task_ha_lights', 'Home Assistant: lights follow sunset', 'homelab', 24, 22, 'stall', '22d');
  T('plan', 'task_run_plan', '12-week half-marathon plan', 'running', 34, 1, 'run', null);
  const X = (id: string, type: Obj['type'], name: string, first: number, last: number, props: Record<string, string>, aliases: string[] = [], evs: Obj['evidencePreview'] = []) =>
    o(id, type, name, first, last, { properties: props, aliases, evidencePreview: evs });
  X('obj_tool_stripe', 'tool', 'Stripe', 24, 1, { category: 'payments' }, ['Stripe Billing'], [ev('Stripe sends invoice.paid twice', 'claude', 'Return 200 for duplicates so Stripe stops retrying.', 4)]);
  X('obj_tool_sqlite', 'tool', 'SQLite', 48, 9, { category: 'database' });
  X('obj_tool_litestream', 'tool', 'Litestream', 46, 9, { category: 'backups' });
  X('obj_tool_typst', 'tool', 'Typst', 26, 20, { category: 'PDF rendering' }, [], [ev('Fast PDF invoice rendering', 'claude', 'Typst renders the invoice in 30 ms vs 1.2 s with headless Chrome.', 21)]);
  X('obj_tool_claudecode', 'tool', 'Claude Code', 2, 1, { category: 'coding agent' });
  X('obj_tool_claudecli', 'tool', 'claude CLI', 2, 2, { category: 'coding agent' });
  X('obj_tool_tokio', 'tool', 'tokio', 14, 11, { category: 'async runtime' });
  X('obj_tool_clap', 'tool', 'clap', 1, 1, { category: 'CLI parsing' });
  X('obj_tool_ha', 'tool', 'Home Assistant', 24, 22, { category: 'home automation' });
  X('obj_tool_buttondown', 'tool', 'Buttondown', 44, 1, { category: 'newsletter' });
  X('obj_person_maya', 'person', 'Maya (designer friend)', 16, 9, { role: 'reviews the pricing page' }, ['Maya'], [ev('Headline A vs B', 'chatgpt', 'Maya will drop both headlines into the mockup and tell me which one reads better.', 9)]);
  X('obj_person_leo', 'person', 'Leo (beta user)', 5, 3, { role: 'freelance photographer, beta tester' }, ['Leo'], [ev('Stripe sends invoice.paid twice', 'claude', 'Leo got two receipts for the same invoice — that’s how I noticed.', 4)]);
  X('obj_person_accountant', 'person', 'Rita (accountant)', 13, 13, { role: 'could answer the VAT question' }, ['Rita']);
  X('obj_org_hn', 'organization', 'Hacker News', 3, 2, { kind: 'community' }, ['HN']);
  X('obj_org_cp', 'organization', 'CP (Portuguese railways)', 2, 2, { kind: 'rail operator' });
  X('obj_place_lisbon', 'place', 'Lisbon', 13, 5, { country: 'Portugal' });
  X('obj_place_porto', 'place', 'Porto', 13, 1, { country: 'Portugal' });
  X('obj_place_sintra', 'place', 'Sintra', 9, 8, { kind: 'day trip' });
  X('obj_place_cascais', 'place', 'Cascais', 9, 8, { kind: 'day trip' });
  X('obj_artifact_plan', 'artifact', 'plan.md (webhook fix)', 3, 1, { format: 'markdown' });
  X('obj_artifact_rules', 'artifact', 'Tide-magic rules sheet', 5, 2, { format: 'one page' });
  X('obj_artifact_query', 'artifact', 'Query letter draft v3', 34, 28, { words: '410' });
  for (const [id, , name, , , atS] of [
    ['obj_decision_en01', '', 'Flat pricing: $9 Solo / $19 Studio, 14-day trial, no free tier', '', '', at(24, '21:58')],
    ['obj_decision_en04', '', 'Deduplicate webhooks with a processed_events table keyed by event id', '', '', at(3, '23:40')],
    ['obj_decision_en05', '', 'Ines discovers the forged ledger herself (no confession)', '', '', at(12, '23:50')],
  ] as const) o(id, 'decision', name, 0, 0, { firstSeenAt: `${atS.replace(' ', 'T')}:00${tzSuffix()}`, lastSeenAt: `${atS.replace(' ', 'T')}:00${tzSuffix()}`, mentionCount: 1 });
  o('obj_topic_launch', 'topic', 'Launch', 3, 2, {}); o('obj_topic_worldbuilding', 'topic', 'Worldbuilding', 12, 2, {});

  let li = 0;
  const L = (type: string, src: string, dst: string, n: number, extra: Partial<Link> = {}) => links.push({
    id: `l${++li}`, type, srcId: src, dstId: dst, status: 'accepted', confidence: 0.9, origin: 'llm', mentionCount: 1, validFrom: ts(n), endedAt: null,
    firstSeenAt: ts(n), lastSeenAt: ts(n), properties: {}, evidencePreview: null, ...extra,
  } as Link);
  const partOf: Array<[string, string, number]> = [['pricing', 'tidepool', 24], ['webhooks', 'tidepool', 4], ['onboarding', 'tidepool', 15], ['showhn', 'tidepool', 3], ['vat', 'tidepool', 16], ['pdf', 'tidepool', 26],
    ['ch7', 'novel', 12], ['magic', 'novel', 5], ['tally', 'rust', 3], ['async', 'rust', 14], ['itinerary', 'portugal', 13], ['trains', 'portugal', 2], ['issue14', 'newsletter', 2], ['ha', 'homelab', 24], ['plan', 'running', 34]];
  for (const [t, p, n] of partOf) L('part_of', `obj_task_${t}`, `obj_project_${p}`, n, { origin: 'rule', confidence: 1 });
  L('uses', 'obj_task_webhooks', 'obj_tool_stripe', 4); L('uses', 'obj_task_webhooks', 'obj_tool_claudecode', 2); L('uses', 'obj_task_pdf', 'obj_tool_typst', 26);
  L('uses', 'obj_project_tidepool', 'obj_tool_sqlite', 48); L('uses', 'obj_project_tidepool', 'obj_tool_litestream', 46); L('uses', 'obj_task_vat', 'obj_tool_stripe', 13);
  L('uses', 'obj_task_async', 'obj_tool_tokio', 14); L('uses', 'obj_task_tally', 'obj_tool_clap', 1); L('uses', 'obj_task_ha', 'obj_tool_ha', 24); L('uses', 'obj_task_issue14', 'obj_tool_buttondown', 1);
  L('blocked_by', 'obj_task_pricing', 'obj_person_maya', 9, { evidencePreview: { ...ev('Headline A vs B', 'chatgpt', 'Waiting for Maya to try both headlines in the mockup.', 9), confidence: 0.86, model: 'seed' } });
  L('blocked_by', 'obj_task_onboarding', 'obj_task_pricing', 7); L('blocked_by', 'obj_task_itinerary', 'obj_place_sintra', 8, { properties: { note: 'Sintra or Cascais?' } });
  L('derived_from', 'obj_task_onboarding', 'obj_task_pricing', 7); L('references', 'obj_task_showhn', 'obj_task_pricing', 2); L('references', 'obj_task_webhooks', 'obj_artifact_plan', 3);
  L('references', 'obj_task_magic', 'obj_artifact_rules', 5); L('related_to', 'obj_person_leo', 'obj_task_webhooks', 4); L('related_to', 'obj_task_showhn', 'obj_org_hn', 3);
  L('related_to', 'obj_project_tidepool', 'obj_project_newsletter', 3); L('related_to', 'obj_task_ch7', 'obj_place_porto', 6, { properties: { note: 'the bookshop scene' } });
  L('located_at', 'obj_task_itinerary', 'obj_place_lisbon', 13); L('located_at', 'obj_task_itinerary', 'obj_place_porto', 13); L('located_at', 'obj_task_itinerary', 'obj_place_cascais', 9);
  L('located_at', 'obj_task_trains', 'obj_place_porto', 2); L('uses', 'obj_task_trains', 'obj_org_cp', 2);
  L('decided', 'obj_task_pricing', 'obj_decision_en01', 24); L('decided', 'obj_task_webhooks', 'obj_decision_en04', 3); L('decided', 'obj_task_ch7', 'obj_decision_en05', 12);
  L('affects', 'obj_decision_en01', 'obj_task_onboarding', 15); L('affects', 'obj_decision_en05', 'obj_artifact_rules', 5);
  L('part_of', 'obj_topic_launch', 'obj_project_tidepool', 3, { origin: 'rule' }); L('related_to', 'obj_topic_worldbuilding', 'obj_task_magic', 5);
  // pending suggestions (shown in the review queue)
  L('blocked_by', 'obj_task_vat', 'obj_person_accountant', 13, { status: 'suggested', confidence: 0.77, evidencePreview: { ...ev('EU VAT for B2B customers', 'gemini', 'If Stripe Tax can’t do it I’ll ask Rita.', 13), confidence: 0.77, model: 'seed' } });
  const sugLink = `l${li}`;
  L('uses', 'obj_task_showhn', 'obj_tool_buttondown', 2, { status: 'suggested', confidence: 0.69 });
  const sugLink2 = `l${li}`;
  objects.find((x) => x.id === 'obj_tool_claudecli')!.status = 'suggested';
  const suggestions = [
    { id: 's1', kind: 'link', confidence: 0.77, linkId: sugLink, reason: 'first_seen_person', note: 'New person — kept as a suggestion regardless of confidence', createdAt: iso(1, '07:00:00') },
    { id: 's2', kind: 'merge', confidence: 0.81, merge: { keepId: 'obj_tool_claudecode', mergeId: 'obj_tool_claudecli' }, reason: 'merge_candidate', note: 'Looks like the same tool under two names', createdAt: iso(1, '07:00:00') },
    { id: 's3', kind: 'link', confidence: 0.69, linkId: sugLink2, reason: 'mid_confidence', note: null, createdAt: iso(0, '07:00:00') },
  ];
  return { today: iso(0, '00:00:00').slice(0, 10), objects, links, suggestions, counts: { objects: objects.length, links: links.length, pendingSuggestions: suggestions.length, hiddenSingleMention: 0 }, truncated: false } as unknown as OntologyGraphResponse;
}
