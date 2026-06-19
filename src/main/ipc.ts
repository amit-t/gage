export const IPC = {
  reports: 'gage:reports', // main → renderer (push UsageReport[])
  refresh: 'gage:refresh', // renderer → main (force a cycle)
  getSettings: 'gage:getSettings',
  setSettings: 'gage:setSettings',
  getClaudeCapture: 'gage:getClaudeCapture', // statusline-hook install status
  setClaudeCapture: 'gage:setClaudeCapture', // install/uninstall the capture hook
  ping: 'gage:ping', // heartbeat (M0)
} as const;
