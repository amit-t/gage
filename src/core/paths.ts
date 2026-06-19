import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

export const CODEX_SESSIONS_DIR = path.join(home, '.codex', 'sessions');
export const CLAUDE_PROJECTS_DIR = path.join(home, '.claude', 'projects');
export const CLAUDE_POWERLINE_CONFIG = path.join(home, '.claude', 'claude-powerline.json');
export const DEVIN_CLI_DIR = path.join(home, '.local', 'share', 'devin', 'cli');
export const DEVIN_DB = path.join(DEVIN_CLI_DIR, 'sessions.db');
export const DEVIN_BUDGET_CONFIG = path.join(home, '.config', 'devin-token-monitor', 'config.json');
