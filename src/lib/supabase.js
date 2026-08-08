import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export const DEVICE_OPTS = [
  { label: 'UCG-Fiber',                key: 'UCG-Fiber',            ports: 8,  u: 1, color: 'purple' },
  { label: 'Mission Critical (8p)',    key: 'USW-Mission-Critical', ports: 9,  u: 1, color: 'blue', sfpStart: 9, sfpCount: 1, rj45_1g: 8, note: '8-port PoE+ · 1 uplink · built-in battery backup' },
  { label: 'USW-Pro-Max-48-POE (48p)', key: 'USW-Pro-Max-48',      ports: 52, u: 1, color: 'blue', sfpStart: 49, sfpCount: 4, rj45_1g: 32, rj45_25g: 16 },
  { label: 'USW-Pro-Max-24 (24p)',     key: 'USW-Pro-Max-24',      ports: 26, u: 1, color: 'blue', sfpStart: 25, sfpCount: 2, rj45_1g: 16, rj45_25g: 8  },
  { label: 'USW-Pro-Max-16 (16p)',     key: 'USW-Pro-Max-16',      ports: 18, u: 1, color: 'blue', sfpStart: 17, sfpCount: 2, rj45_1g: 12, rj45_25g: 4  },
  { label: 'USW-Flex-Mini (5p)',       key: 'USW-Flex-Mini',       ports: 5,  u: 1, color: 'teal', mountOptions: ['rack','wall']  },
  { label: 'USW-Ultra (7p)',           key: 'USW-Ultra',           ports: 7,  u: 1, color: 'teal', mountOptions: ['rack','wall']  },
  { label: 'Patch Panel 48p',          key: 'Patch Panel',         ports: 48, u: 1, color: 'green' },
  { label: 'Patch Panel 24p',          key: 'Patch Panel',         ports: 24, u: 1, color: 'green' },
  { label: 'Patch Panel 12p',          key: 'Patch Panel',         ports: 12, u: 1, color: 'green' },
  { label: 'UniFi UPS Pro (2U)',        key: 'UUPS-PRO',            ports: 0,  u: 2, color: 'gray', mountOptions: ['rack','floor']  },
  { label: 'UniFi UPS Tower',           key: 'UUPS-TOWER',          ports: 0,  u: 0, color: 'gray', mountOptions: ['rack','wall','floor']  },
  { label: 'Empty 1U spacer',          key: 'empty',               ports: 0,  u: 1, color: 'gray'  },
];

export const ICON_MAP = {
  'UCG-Fiber': 'ti-antenna',
  'USW-Mission-Critical': 'ti-shield-bolt',
  'USW-Pro-Max-48': 'ti-switch',
  'USW-Pro-Max-24': 'ti-switch',
  'USW-Pro-Max-16': 'ti-switch',
  'USW-Flex-Mini': 'ti-switch-2',
  'USW-Ultra': 'ti-switch-2',
  'Patch Panel': 'ti-grid-dots',
  'UPS/PDU': 'ti-bolt',
  'UUPS-PRO': 'ti-bolt',
  'UUPS-TOWER': 'ti-bolt',
};

export const COLOR_MAP = {
  blue:   { bg: '#dbeafe', text: '#1e40af', slot: '#60a5fa', rack: '#0c1f3d', label: '#93c5fd' },
  teal:   { bg: '#ccfbf1', text: '#0f766e', slot: '#2dd4bf', rack: '#07201e', label: '#5eead4' },
  green:  { bg: '#dcfce7', text: '#166534', slot: '#4ade80', rack: '#0a2010', label: '#86efac' },
  purple: { bg: '#ede9fe', text: '#6d28d9', slot: '#a78bfa', rack: '#1e0a3c', label: '#c4b5fd' },
  gray:   { bg: '#f1f5f9', text: '#475569', slot: '#6b7280', rack: '#1c1f26', label: '#d4d4d8' },
};

export const canWrite = (role) => ['admin', 'tech'].includes(role);
export const isAdmin  = (role) => role === 'admin';
