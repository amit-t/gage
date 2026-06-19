import type { UsageReport, UsageStatus, Settings } from '../core/types';

type DecoratedReport = UsageReport & { displayName?: string; stale?: boolean };

declare global {
  interface Window {
    gage: {
      onReports: (cb: (reports: DecoratedReport[]) => void) => () => void;
      refresh: () => void;
      getSettings: () => Promise<Settings>;
      setSettings: (s: Partial<Settings>) => Promise<Settings>;
      ping: () => Promise<string>;
    };
  }
}

const STATUS_ORDER: Record<UsageStatus, number> = { ok: 0, tight: 1, blocked: 2, noData: 3, unknown: 4 };
const DOT: Record<UsageStatus, string> = { ok: '🟢', tight: '🟡', blocked: '🔴', noData: '⚪', unknown: '⚠️' };

function sortReports(reports: DecoratedReport[]): DecoratedReport[] {
  return [...reports].sort((a, b) => {
    const ah = a.headroomPct;
    const bh = b.headroomPct;
    if (ah !== undefined && bh !== undefined) return bh - ah; // higher headroom first
    if (ah !== undefined) return -1;
    if (bh !== undefined) return 1;
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; // both undefined ⇒ by status
  });
}

function fmtReset(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'resetting…';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  return `resets in ${h}h ${m % 60}m`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function row(r: DecoratedReport): HTMLElement {
  const el = document.createElement('div');
  el.className = `row status-${r.status}`;
  const pct = r.headroomPct !== undefined ? `${Math.round(r.headroomPct)}%` : '—';
  const barW = r.headroomPct !== undefined ? Math.round(r.headroomPct) : 0;
  el.innerHTML = `
    <div class="row-head">
      <span class="dot">${DOT[r.status]}</span>
      <span class="name">${esc(r.displayName ?? r.agent)}</span>
      <span class="pct">${pct}</span>
    </div>
    <div class="bar"><div class="bar-fill" style="width:${barW}%"></div></div>
    <div class="sub">${r.stale ? '⏳ stale · ' : ''}${esc(fmtReset(r.resetAt))}${r.hint ? ` · ${esc(r.hint)}` : ''}</div>
    <div class="detail" hidden>
      ${r.windows.map((w) => `<div>${esc(w.label)}: ${Math.round(w.headroomPct)}% ${esc(fmtReset(w.resetAt))}</div>`).join('')}
      ${r.raw.map((m) => `<div class="raw">${esc(m.label)}: ${esc(m.value)}</div>`).join('')}
      <div class="meta">source: ${esc(r.source)}</div>
      <div class="meta">fetched: ${new Date(r.fetchedAt).toLocaleTimeString()}</div>
      ${r.error ? `<div class="err">error: ${esc(r.error)}</div>` : ''}
    </div>`;
  el.querySelector('.row-head')!.addEventListener('click', () => {
    const d = el.querySelector('.detail') as HTMLElement;
    d.hidden = !d.hidden;
  });
  return el;
}

const rowsEl = document.getElementById('rows')!;

function render(reports: DecoratedReport[]): void {
  rowsEl.innerHTML = '';
  if (reports.length === 0) {
    rowsEl.innerHTML = '<div class="empty">No agents enabled.</div>';
    return;
  }
  for (const r of sortReports(reports)) rowsEl.appendChild(row(r));
}

window.gage.onReports(render);
window.gage.refresh();

// --- settings pane ---
const settingsEl = document.getElementById('settings')!;
document.getElementById('refresh')!.addEventListener('click', () => window.gage.refresh());
document.getElementById('toggle-settings')!.addEventListener('click', async () => {
  settingsEl.hidden = !settingsEl.hidden;
  if (!settingsEl.hidden) renderSettings(await window.gage.getSettings());
});

function renderSettings(s: Settings): void {
  const agents = ['codex', 'claude', 'devin'] as const;
  const modes = ['best', 'count', 'icon'] as const;
  settingsEl.innerHTML = `
    <h4>Agents</h4>
    ${agents
      .map((id) => `<label><input type="checkbox" data-agent="${id}" ${s.enabled[id] ? 'checked' : ''}/> ${id}</label>`)
      .join('')}
    <h4>Tray title</h4>
    <select id="tray-mode">
      ${modes.map((m) => `<option value="${m}" ${s.trayTitleMode === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>
    <p class="meta">Devin budget: <code>devin-usage budget --start YYYY-MM-DD --acu N</code></p>
    <p class="meta">Claude budget: set <code>budget.session.amount</code> in ~/.claude/claude-powerline.json</p>`;
  settingsEl.querySelectorAll<HTMLInputElement>('input[data-agent]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const enabled = { [cb.dataset.agent!]: cb.checked } as unknown as Settings['enabled'];
      void window.gage.setSettings({ enabled }).then(() => window.gage.refresh());
    }),
  );
  (settingsEl.querySelector('#tray-mode') as HTMLSelectElement).addEventListener('change', (e) =>
    window.gage.setSettings({ trayTitleMode: (e.target as HTMLSelectElement).value as Settings['trayTitleMode'] }),
  );
}
