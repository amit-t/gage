import type { AgentAdapter, Settings } from './types';

export function enabledAdapters(all: AgentAdapter[], settings: Settings): AgentAdapter[] {
  return all.filter((a) => settings.enabled[a.id]);
}
