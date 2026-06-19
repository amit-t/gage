export const IPC = {
  reports: 'gage:reports', // main → renderer (push UsageReport[])
  refresh: 'gage:refresh', // renderer → main (force a cycle)
  getSettings: 'gage:getSettings',
  setSettings: 'gage:setSettings',
  ping: 'gage:ping', // heartbeat (M0)
} as const;
