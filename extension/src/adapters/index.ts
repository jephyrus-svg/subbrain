import type { SiteAi } from '../shared/contract';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import type { Adapter } from './types';
export const ADAPTERS: Record<SiteAi, Adapter> = { chatgpt: chatgptAdapter, claude: claudeAdapter };
export function adapterForHost(host: string): Adapter | null {
  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return chatgptAdapter;
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) return claudeAdapter;
  return null;
}
