import { makeAdapter } from './base';
import { CLAUDE } from './selectors';
export const claudeAdapter = makeAdapter('claude', 'claude-dom', '0.1.0', CLAUDE);
