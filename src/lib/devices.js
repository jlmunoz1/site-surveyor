export const DEVICE_DEFS = [
  {
    section: 'Cameras',
    items: [
      { dtype: 'reolink-fe', label: 'Reolink Fisheye', color: '#185FA5', coverage: 110, heatmap: false },
      { dtype: 'cam-dome',   label: 'Dome Camera',     color: '#378ADD', coverage: 70,  heatmap: false },
      { dtype: 'cam-bullet', label: 'Bullet Camera',   color: '#0C447C', coverage: 55,  heatmap: false },
    ]
  },
  {
    section: 'LoRa / IoT',
    items: [
      { dtype: 'rak-gw',   label: 'RAK Gateway', color: '#3B6D11', coverage: 0, heatmap: true  },
      { dtype: 'rak-node', label: 'RAK Node',     color: '#639922', coverage: 0, heatmap: false },
    ]
  },
  {
    section: 'Network',
    items: [
      { dtype: 'mdf',    label: 'MDF',          color: '#534AB7', coverage: 0,  heatmap: false },
      { dtype: 'idf',    label: 'IDF',          color: '#7F77DD', coverage: 0,  heatmap: false },
      { dtype: 'switch', label: 'PoE Switch',   color: '#3C3489', coverage: 0,  heatmap: false },
      { dtype: 'ap',     label: 'Access Point', color: '#534AB7', coverage: 80, heatmap: false },
      { dtype: 'nvr',    label: 'NVR/DVR',      color: '#26215C', coverage: 0,  heatmap: false },
    ]
  },
  {
    section: 'Access',
    items: [
      { dtype: 'reader',   label: 'Card Reader', color: '#1D9E75', coverage: 0, heatmap: false },
      { dtype: 'intercom', label: 'Intercom',    color: '#888780', coverage: 0, heatmap: false },
    ]
  }
]

export const CABLE_STYLES = {
  cat6:  { stroke: '#378ADD', width: 2,   dash: ''    },
  fiber: { stroke: '#E24B4A', width: 2,   dash: '6,4' },
  coax:  { stroke: '#1D9E75', width: 2,   dash: '2,4' },
  power: { stroke: '#BA7517', width: 2.5, dash: '8,4' },
}

export function getIconPaths(dtype, color) {
  const c = color

  // RAK Gateway — 8-pointed snowflake/asterisk (4 axes + dot tips)
  // 8-petal flower matching Sage logo style — rounded oval petals radiating from center
  const rakSnowflake = [
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(0 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(45 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(90 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(135 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(180 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(225 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(270 17 17)"/>`,
    `<ellipse cx="17" cy="9" rx="3.8" ry="7" fill="${c}" transform="rotate(315 17 17)"/>`,
    `<circle cx="17" cy="17" r="3.5" fill="${c}"/>`,
  ].join('')

  const icons = {
    'reolink-fe': `<circle cx="17" cy="17" r="14" fill="${c}18" stroke="${c}" stroke-width="2"/><circle cx="17" cy="17" r="8" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="17" cy="17" r="3" fill="${c}"/><line x1="17" y1="3" x2="17" y2="9" stroke="${c}" stroke-width="1.5"/><line x1="17" y1="25" x2="17" y2="31" stroke="${c}" stroke-width="1.5"/><line x1="3" y1="17" x2="9" y2="17" stroke="${c}" stroke-width="1.5"/><line x1="25" y1="17" x2="31" y2="17" stroke="${c}" stroke-width="1.5"/>`,
    'cam-dome':   `<path d="M6 22 Q6 8 17 8 Q28 8 28 22" fill="${c}18" stroke="${c}" stroke-width="2"/><rect x="7" y="21" width="20" height="6" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><circle cx="17" cy="15" r="4" fill="${c}"/>`,
    'cam-bullet': `<rect x="4" y="12" width="20" height="10" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><polygon points="24,12 30,17 24,22" fill="${c}"/><circle cx="12" cy="17" r="3" fill="${c}"/>`,
    'rak-gw':     rakSnowflake,
    'rak-node':   `<rect x="8" y="10" width="18" height="14" rx="2.5" fill="${c}18" stroke="${c}" stroke-width="2"/><line x1="17" y1="3" x2="17" y2="10" stroke="${c}" stroke-width="2"/><circle cx="17" cy="17" r="3" fill="${c}"/>`,
    'mdf':        `<rect x="3" y="7" width="28" height="20" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><text x="17" y="21" text-anchor="middle" font-size="10" font-weight="700" fill="${c}" font-family="monospace">MDF</text>`,
    'idf':        `<rect x="3" y="7" width="28" height="20" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><text x="17" y="21" text-anchor="middle" font-size="10" font-weight="700" fill="${c}" font-family="monospace">IDF</text>`,
    'switch':     `<rect x="3" y="10" width="28" height="14" rx="2.5" fill="${c}18" stroke="${c}" stroke-width="2"/><circle cx="9" cy="17" r="2.5" fill="${c}"/><circle cx="17" cy="17" r="2.5" fill="${c}"/><circle cx="25" cy="17" r="2.5" fill="${c}" opacity=".35"/>`,
    'ap':         `<path d="M7 21 Q17 9 27 21" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M11 25 Q17 17 23 25" fill="none" stroke="${c}" stroke-width="1.8"/><circle cx="17" cy="27" r="2.5" fill="${c}"/>`,
    'nvr':        `<rect x="3" y="9" width="28" height="16" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><rect x="6" y="12" width="9" height="10" rx="1.5" fill="${c}" opacity=".2" stroke="${c}" stroke-width="1.5"/><circle cx="21" cy="17" r="3" fill="${c}" opacity=".5"/><circle cx="27" cy="12" r="1.5" fill="${c}"/>`,
    'reader':     `<rect x="8" y="5" width="18" height="24" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/><rect x="11" y="10" width="12" height="7" rx="1.5" fill="none" stroke="${c}" stroke-width="1.5"/><line x1="11" y1="21" x2="23" y2="21" stroke="${c}" stroke-width="1.2" opacity=".6"/>`,
    'intercom':   `<path d="M10 7 Q7 7 7 10 L7 17 Q7 25 17 25 Q27 25 27 17 L27 10 Q27 7 24 7 Z" fill="${c}18" stroke="${c}" stroke-width="2"/><circle cx="17" cy="15" r="4" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  }

  return icons[dtype] || `<rect x="7" y="7" width="20" height="20" rx="3" fill="${c}18" stroke="${c}" stroke-width="2"/>`
}

export function DeviceIcon({ dtype, color, size = 34 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      dangerouslySetInnerHTML={{ __html: getIconPaths(dtype, color) }}
    />
  )
}
