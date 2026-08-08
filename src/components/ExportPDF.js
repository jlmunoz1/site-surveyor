import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// STATUS colours (matches PortMapperTab conventions)
const STATUS_COLOR = {
  used:     { bg: '#dcfce7', text: '#166534', label: 'Used' },
  unused:   { bg: '#f1f5f9', text: '#64748b', label: 'Unused' },
  reserved: { bg: '#fef9c3', text: '#854d0e', label: 'Reserved' },
  issue:    { bg: '#fee2e2', text: '#991b1b', label: 'Issue' },
};

const POE_STYLE = {
  'PoE++':   { bg: '#ede9fe', color: '#6d28d9' },
  'PoE+':    { bg: '#dbeafe', color: '#1e40af' },
  'PoE+/++': { bg: '#e0e7ff', color: '#3730a3' },
  '—':       { bg: '#f1f5f9', color: '#475569' },
  'None':    { bg: '#f1f5f9', color: '#475569' },
};

const SWITCH_POE = {
  'UCG-Fiber':        { rows: [{ ports:'1', speed:'2.5G', poe:'PoE++', watts:'60W', note:'5G Backup' }, { ports:'2–8', speed:'1G', poe:'PoE+', watts:'30W' }] },
  'Mission Critical': { rows: [{ ports:'1–8', speed:'1G', poe:'PoE+', watts:'30W', note:'RAK LoRa' }, { ports:'9', speed:'1G', poe:'—', watts:'—', note:'Uplink' }] },
  'USW-Pro-Max-16':   { rows: [{ ports:'1–12', speed:'1G', poe:'PoE+', watts:'30W' }, { ports:'13–16', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–2', speed:'10G', poe:'—', watts:'—' }] },
  'USW-Pro-Max-24':   { rows: [{ ports:'1–16', speed:'1G', poe:'PoE+/++', watts:'30–60W' }, { ports:'17–24', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–2', speed:'10G', poe:'—', watts:'—' }] },
  'USW-Pro-Max-48':   { rows: [{ ports:'1–32', speed:'1G', poe:'PoE+/++', watts:'30–60W' }, { ports:'33–48', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–4', speed:'10G', poe:'—', watts:'—' }] },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function loadJsPDF() {
  return new Promise(resolve => {
    if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    document.head.appendChild(s);
  });
}

function addPageHeader(pdf, title, pageW) {
  pdf.setFillColor(27, 58, 107);
  pdf.rect(0, 0, pageW, 32, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Sage Port Mapper', 14, 21);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(title, pageW / 2, 21, { align: 'center' });
  pdf.setTextColor(147, 180, 217);
  pdf.setFontSize(9);
  pdf.text(new Date().toLocaleDateString(), pageW - 14, 21, { align: 'right' });
  pdf.setTextColor(30, 41, 59);
}

function sectionHeading(pdf, text, y, pageW) {
  pdf.setFillColor(241, 245, 249);
  pdf.rect(14, y, pageW - 28, 14, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(30, 41, 59);
  pdf.text(text, 20, y + 9.5);
  return y + 20;
}

// ── main export ──────────────────────────────────────────────────────────────

export async function exportFullPDF({ mapCanvasRef, sites: propSites, statusMsg, siteId = null, siteName = null }) {
  try {
  statusMsg('Loading data…');

  // Load all data sequentially so we can debug each step
  const jsPDF = await loadJsPDF();

  statusMsg('Loading sites…');
  const { data: allSites = [] } = await supabase.from('sites').select('*').order('name');
  const sites = siteId ? allSites.filter(s => s.id === siteId) : allSites;
  statusMsg('Loading racks… (' + sites.length + ' sites)');

  const { data: allRacks = [] } = siteId
    ? await supabase.from('racks').select('*').eq('site_id', siteId).order('name')
    : await supabase.from('racks').select('*').order('name');
  const racks = allRacks;
  statusMsg('Loading devices… (' + racks.length + ' racks)');

  const rackIds = racks.map(r => r.id);
  const { data: devicesRaw = [] } = rackIds.length
    ? await supabase.from('devices').select('*').in('rack_id', rackIds)
    : { data: [] };
  const devices = (devicesRaw || []).sort((a,b) => (a.sort_order||0)-(b.sort_order||0));
  statusMsg('Loading ports… (' + devices.length + ' devices)');

  const deviceIds = devices.map(d => d.id);
  const { data: portsRaw = [] } = deviceIds.length
    ? await supabase.from('ports').select('*').in('device_id', deviceIds)
    : { data: [] };
  const ports = portsRaw || [];
  statusMsg('Loading rules…');

  const { data: rules = [] } = await supabase.from('port_rules').select('*');
  const { data: allNodes = [] } = await supabase.from('map_nodes').select('id,pos_x,pos_y,site_id,type,label,sub_label');
  const mapNodes = siteId ? allNodes.filter(n => n.site_id === siteId) : allNodes;
  statusMsg('Building PDF… (' + ports.length + ' ports)');

  const pdf      = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW    = pdf.internal.pageSize.getWidth();   // 792
  const pageH    = pdf.internal.pageSize.getHeight();  // 612
  const PAGE_H   = pageH;
  const PAGE_BOT = pageH - 16;
  const margin   = 14;
  const contentW = pageW - margin * 2;

  // ── PAGE 1: Network Map — rendered in light mode onto offscreen canvas ──────
  statusMsg('Rendering network map…');

  // Node styles matching the app's dark navy aesthetic
  const PDF_NODE = {
    mdf:           { fill: '#1a2f5a', stroke: '#6d28d9', text: '#ffffff', badge: '#a78bfa', w: 170, h: 64 },
    idf:           { fill: '#1B3A6B', stroke: '#2E75B6', text: '#ffffff', badge: '#93c5fd', w: 160, h: 60 },
    mc:            { fill: '#1e3a5f', stroke: '#1d4ed8', text: '#ffffff', badge: '#93c5fd', w: 150, h: 58 },
    flex:          { fill: '#134e4a', stroke: '#0d9488', text: '#ffffff', badge: '#5eead4', w: 140, h: 54 },
    patch:         { fill: '#14532d', stroke: '#15803d', text: '#ffffff', badge: '#86efac', w: 140, h: 54 },
    ups:           { fill: '#374151', stroke: '#6b7280', text: '#ffffff', badge: '#d1d5db', w: 130, h: 54 },
    backbone_only: { fill: '#2d1b69', stroke: '#7c3aed', text: '#ffffff', badge: '#c4b5fd', w: 160, h: 60 },
    passthrough:   { fill: '#164e63', stroke: '#0891b2', text: '#ffffff', badge: '#67e8f9', w: 160, h: 60 },
  };
  const PDF_LINK = {
    backbone: { color: '#7c3aed', width: 2 },
    internal: { color: '#0891b2', width: 1.5 },
    fiber:    { color: '#7c3aed', width: 1.5 },
    generic:  { color: '#94a3b8', width: 1.5 },
  };

  // rrectCtx — must be outside try block (strict mode)
  const rrectCtx = (c, x, y, w, h, r) => {
    c.beginPath(); c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
  };

  let mapImageData = null;
  if (mapNodes.length > 0) {
    try {
      statusMsg('Fetching map links…');
      const { data: mapLinks } = await supabase.from('map_links').select('*');
      const lnks = mapLinks || [];
      statusMsg('Drawing map…');

      // Bounding box of all nodes
      const PAD = 60;
      const xs  = mapNodes.map(n => n.pos_x), ys = mapNodes.map(n => n.pos_y);
      const minX = Math.min(...xs) - PAD, maxX = Math.max(...xs) + PAD;
      const minY = Math.min(...ys) - PAD, maxY = Math.max(...ys) + PAD;
      const worldW = maxX - minX, worldH = maxY - minY;

      // Cap canvas size to avoid memory issues (max 3000×2000)
      const MAX_W = 3000, MAX_H = 2000;
      const sc = Math.min(MAX_W / worldW, MAX_H / worldH, 1.5);
      const canvW = Math.min(Math.ceil(worldW * sc) + 4, MAX_W);
      const canvH = Math.min(Math.ceil(worldH * sc) + 4, MAX_H);

      const off  = document.createElement('canvas');
      off.width  = canvW; off.height = canvH;
      const ctx  = off.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvW, canvH);

      // Light grid
      ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 0.5;
      for (let gx = 0; gx < canvW; gx += 50) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvH); ctx.stroke(); }
      for (let gy = 0; gy < canvH; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvW, gy); ctx.stroke(); }

      // Helper: world → canvas coords
      const wx = x => (x - minX) * sc + 2;
      const wy = y => (y - minY) * sc + 2;

      // Node map
      const nmap = {};
      mapNodes.forEach(n => { nmap[n.id] = n; });

      // Build pair index for label offsetting (same as NetworkMapTab)
      const pairCount = {}, pairIdx = {};
      lnks.forEach(lnk => {
        const key = [lnk.from_id, lnk.to_id].sort().join('|');
        pairCount[key] = (pairCount[key] || 0) + 1;
      });
      const pairSeen = {};
      lnks.forEach(lnk => {
        const key = [lnk.from_id, lnk.to_id].sort().join('|');
        pairIdx[lnk.id] = pairSeen[key] || 0;
        pairSeen[key] = (pairSeen[key] || 0) + 1;
      });

      // Draw links first
      lnks.forEach(lnk => {
        const fn = nmap[lnk.from_id], tn = nmap[lnk.to_id];
        if (!fn || !tn) return;
        const ls = PDF_LINK[lnk.link_type] || PDF_LINK.generic;
        const fx = wx(fn.pos_x), fy = wy(fn.pos_y);
        const tx = wx(tn.pos_x), ty = wy(tn.pos_y);
        const my = (fy + ty) / 2;
        ctx.beginPath();
        if (Math.abs(fx - tx) < 2) { ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); }
        else { ctx.moveTo(fx, fy); ctx.lineTo(fx, my); ctx.lineTo(tx, my); ctx.lineTo(tx, ty); }
        ctx.strokeStyle = ls.color; ctx.lineWidth = ls.width * sc;
        ctx.stroke();
        // Arrowhead
        const al = 7 * sc;
        ctx.beginPath(); ctx.moveTo(tx - al/2, ty - al); ctx.lineTo(tx, ty); ctx.lineTo(tx + al/2, ty - al);
        ctx.strokeStyle = ls.color; ctx.lineWidth = 1.2 * sc; ctx.stroke();

        // Label pill
        if (lnk.label) {
          const pKey    = [lnk.from_id, lnk.to_id].sort().join('|');
          const pTotal  = pairCount[pKey] || 1;
          const pI      = pairIdx[lnk.id] || 0;
          const SLOT_H  = 20 * sc;
          const lx      = fx + (tx - fx) * 0.35;
          const lyBase  = (fy + ty) / 2;
          const ly      = lyBase + (pI - (pTotal - 1) / 2) * SLOT_H;

          const fontSize = 9 * sc;
          ctx.font = `600 ${fontSize}px sans-serif`;
          const MAX_CHARS = 32;
          const displayLabel = lnk.label.length > MAX_CHARS
            ? lnk.label.slice(0, MAX_CHARS) + '…' : lnk.label;
          const tw  = ctx.measureText(displayLabel).width;
          const ph  = fontSize * 1.7;
          const pw  = tw + 14 * sc;
          const pr  = ph / 2;
          const lxA = lx, lyA = ly - ph / 2 - 4 * sc;

          // Shadow
          ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 4 * sc;
          // Pill background
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(lxA - pw/2 + pr, lyA);
          ctx.lineTo(lxA + pw/2 - pr, lyA);
          ctx.arcTo(lxA + pw/2, lyA, lxA + pw/2, lyA + pr, pr);
          ctx.lineTo(lxA + pw/2, lyA + ph - pr);
          ctx.arcTo(lxA + pw/2, lyA + ph, lxA + pw/2 - pr, lyA + ph, pr);
          ctx.lineTo(lxA - pw/2 + pr, lyA + ph);
          ctx.arcTo(lxA - pw/2, lyA + ph, lxA - pw/2, lyA + ph - pr, pr);
          ctx.lineTo(lxA - pw/2, lyA + pr);
          ctx.arcTo(lxA - pw/2, lyA, lxA - pw/2 + pr, lyA, pr);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
          // Border
          ctx.strokeStyle = ls.color; ctx.lineWidth = 1.5 * sc;
          ctx.stroke();
          // Text
          ctx.fillStyle = '#1e293b'; ctx.textAlign = 'center';
          ctx.fillText(displayLabel, lxA, lyA + ph * 0.68);
          ctx.textAlign = 'left';
        }
      });

      // Draw nodes
      mapNodes.forEach(n => {
        const nt = PDF_NODE[n.type] || PDF_NODE.idf;
        const cx = wx(n.pos_x), cy = wy(n.pos_y);
        const nw = nt.w * sc, nh = nt.h * sc;
        const nx = cx - nw/2, ny = cy - nh/2;

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 6 * sc;
        rrectCtx(ctx, nx, ny, nw, nh, 6 * sc);
        ctx.fillStyle = nt.fill; ctx.fill();
        ctx.shadowBlur = 0;

        // Border
        ctx.strokeStyle = nt.stroke; ctx.lineWidth = 1.5 * sc;
        rrectCtx(ctx, nx, ny, nw, nh, 6 * sc); ctx.stroke();

        // Type badge
        const bw = nw * 0.55, bh = 13 * sc, bx = nx + 5 * sc, by = ny - bh/2;
        rrectCtx(ctx, bx, by, bw, bh, bh/2);
        ctx.fillStyle = nt.stroke + '30'; ctx.fill();
        ctx.strokeStyle = nt.stroke; ctx.lineWidth = 0.8 * sc;
        rrectCtx(ctx, bx, by, bw, bh, bh/2); ctx.stroke();
        ctx.font = `600 ${8 * sc}px sans-serif`;
        ctx.fillStyle = nt.badge; ctx.textAlign = 'left';
        ctx.fillText((n.type || 'IDF').toUpperCase(), bx + 4 * sc, by + bh * 0.73);

        // Label — truncate long names
        const maxLabelW = nw - 12 * sc;
        ctx.font = `600 ${12 * sc}px sans-serif`;
        ctx.fillStyle = nt.text; ctx.textAlign = 'center';
        let labelText = n.label || '';
        while (ctx.measureText(labelText).width > maxLabelW && labelText.length > 4) {
          labelText = labelText.slice(0, -1);
        }
        if (labelText !== n.label) labelText += '…';
        ctx.fillText(labelText, cx, cy + 3 * sc);

        // Sub-label
        if (n.sub_label && n.sub_label !== n.label) {
          ctx.font = `${9 * sc}px sans-serif`;
          ctx.fillStyle = nt.badge;
          let subText = n.sub_label;
          while (ctx.measureText(subText).width > maxLabelW && subText.length > 4) {
            subText = subText.slice(0, -1);
          }
          if (subText !== n.sub_label) subText += '…';
          ctx.fillText(subText, cx, cy + nh/2 - 6 * sc);
        }
      });

      mapImageData = off.toDataURL('image/jpeg', 0.95);
      if (mapImageData.length < 500) mapImageData = null;
    } catch (e) { console.warn('Light-mode map render failed:', e); }
  }

  if (mapImageData) {
    try {
      const imgEl = new Image();
      await new Promise(r => { imgEl.onload = r; imgEl.src = mapImageData; });
      const iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
      const mapAreaW = pageW, mapAreaH = pageH - 32;
      const scale = Math.min(mapAreaW / iw, mapAreaH / ih);
      const drawW = iw * scale, drawH = ih * scale;
      // White fill behind map
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 32, pageW, mapAreaH, 'F');
      pdf.addImage(mapImageData, 'JPEG', (mapAreaW - drawW) / 2, 32 + (mapAreaH - drawH) / 2, drawW, drawH);
    } catch (e) { console.warn('addImage failed:', e); }
  }
  addPageHeader(pdf, siteName ? `Network Map — ${siteName}` : 'Network Topology Map', pageW);

  // ── PAGE: Equipment List ─────────────────────────────────────────────────
  statusMsg('Building equipment list…');
  pdf.addPage('letter', 'landscape');
  addPageHeader(pdf, siteName ? `Equipment List — ${siteName}` : 'Equipment List', pageW);

  {
    let ey = 46;
    const eqCols = {
      site:   margin,
      rack:   margin + 120,
      device: margin + 240,
      type:   margin + 420,
      ports:  margin + 530,
      usize:  margin + 570,
      mount:  margin + 620,
    };

    // Header row
    pdf.setFillColor(27, 58, 107);
    pdf.rect(margin, ey, contentW, 16, 'F');
    pdf.setTextColor(200, 220, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    [['SITE', eqCols.site], ['RACK', eqCols.rack], ['DEVICE / LABEL', eqCols.device],
     ['TYPE', eqCols.type], ['PORTS', eqCols.ports], ['U', eqCols.usize], ['MOUNT', eqCols.mount]
    ].forEach(([h, x]) => pdf.text(h, x + 4, ey + 11));
    ey += 20;

    // Group devices by site → rack
    let rowIdx = 0;
    for (const site of sites) {
      const siteRacks = racks.filter(r => r.site_id === site.id);
      for (const rack of siteRacks) {
        const rackDevs = devices
          .filter(d => d.rack_id === rack.id)
          .sort((a,b) => (a.sort_order||0)-(b.sort_order||0));
        if (rackDevs.length === 0) continue;

        // Rack row
        if (ey + 14 > PAGE_BOT) {
          pdf.addPage('letter', 'landscape');
          addPageHeader(pdf, siteName ? `Equipment List — ${siteName} (cont.)` : 'Equipment List (cont.)', pageW);
          ey = 46;
          pdf.setFillColor(27, 58, 107);
          pdf.rect(margin, ey, contentW, 16, 'F');
          pdf.setTextColor(200, 220, 255);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7);
          [['SITE', eqCols.site], ['RACK', eqCols.rack], ['DEVICE / LABEL', eqCols.device],
           ['TYPE', eqCols.type], ['PORTS', eqCols.ports], ['U', eqCols.usize], ['MOUNT', eqCols.mount]
          ].forEach(([h, x]) => pdf.text(h, x + 4, ey + 11));
          ey += 20;
          rowIdx = 0;
        }
        // Rack heading row
        pdf.setFillColor(232, 240, 254);
        pdf.rect(margin, ey, contentW, 14, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(27, 58, 107);
        pdf.text(site.name.slice(0, 20), eqCols.site + 4, ey + 10);
        pdf.text(rack.name.slice(0, 20), eqCols.rack + 4, ey + 10);
        pdf.setTextColor(71, 85, 105);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.text(`${rack.u_size || '?'}U rack · ${rackDevs.length} device${rackDevs.length !== 1 ? 's' : ''}`, eqCols.device + 4, ey + 10);
        // Rack type badge
        const rackMountLabel = rack.rack_type === 'wall-mount' ? 'Wall Mount' : rack.rack_type === 'community' ? 'Community' : 'Vertical';
        const rackMountColor = rack.rack_type === 'wall-mount' ? '#0369a1' : rack.rack_type === 'community' ? '#854d0e' : '#7c3aed';
        const [rmr, rmg, rmb] = hexToRgb(rackMountColor);
        pdf.setFillColor(rmr, rmg, rmb);
        pdf.roundedRect(eqCols.mount + 2, ey + 2.5, 60, 10, 2, 2, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.text(rackMountLabel, eqCols.mount + 32, ey + 9.5, { align: 'center' });
        ey += 15;
        rowIdx++;

        for (const dev of rackDevs) {
          if (ey + 14 > PAGE_BOT) {
            pdf.addPage('letter', 'landscape');
            addPageHeader(pdf, siteName ? `Equipment List — ${siteName} (cont.)` : 'Equipment List (cont.)', pageW);
            ey = 46;
            // Redraw header
            pdf.setFillColor(27, 58, 107);
            pdf.rect(margin, ey, contentW, 16, 'F');
            pdf.setTextColor(200, 220, 255);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(7);
            [['SITE', eqCols.site], ['RACK', eqCols.rack], ['DEVICE / LABEL', eqCols.device],
             ['TYPE', eqCols.type], ['PORTS', eqCols.ports], ['U', eqCols.usize], ['MOUNT', eqCols.mount]
            ].forEach(([h, x]) => pdf.text(h, x + 4, ey + 11));
            ey += 20;
            rowIdx = 0;
          }

          // Alternating row background
          if (rowIdx % 2 === 0) {
            pdf.setFillColor(248, 250, 252);
            pdf.rect(margin, ey, contentW, 14, 'F');
          }

          const isWall  = dev.u_size === 0 || dev.device_key === 'USW-Flex-Mini' || dev.device_key === 'USW-Ultra';
          const isFloor = dev.device_key === 'UUPS-TOWER';
          const mountLabel = isFloor ? 'Floor' : isWall ? 'Wall' : 'Rack';
          // bg/text pairs for each mount type
          const mountStyles = {
            Floor: { bg: [254,243,199], text: [146,64,14] },
            Wall:  { bg: [207,250,254], text: [8,145,178] },
            Rack:  { bg: [241,245,249], text: [71,85,105] },
          };
          const ms = mountStyles[mountLabel];

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(30, 41, 59);
          pdf.text(site.name.slice(0, 16),         eqCols.site   + 4, ey + 10);
          pdf.text(rack.name.slice(0, 16),         eqCols.rack   + 4, ey + 10);
          pdf.setFont('helvetica', 'bold');
          pdf.text((dev.label || '').slice(0, 24),  eqCols.device + 4, ey + 10);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(71, 85, 105);
          pdf.text((dev.device_key || '').slice(0, 22), eqCols.type + 4, ey + 10);
          pdf.setTextColor(30, 41, 59);
          pdf.text(String(dev.ports || 0),          eqCols.ports  + 4, ey + 10);
          const uLabel = dev.u_size > 0 ? dev.u_size + 'U' : '—';
          const uDisplay = (rack.rack_type === 'community' && dev.u_start) ? `U${dev.u_start}–${dev.u_start + (dev.u_size||1) - 1}` : uLabel;
          pdf.text(uDisplay, eqCols.usize + 4, ey + 10);

          // Mount badge
          pdf.setFillColor(...ms.bg);
          pdf.roundedRect(eqCols.mount + 2, ey + 2.5, 44, 10, 2, 2, 'F');
          pdf.setTextColor(...ms.text);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7);
          pdf.text(mountLabel, eqCols.mount + 24, ey + 9.5, { align: 'center' });

          ey += 14;
          rowIdx++;
        }
      }
    }

    // Summary row
    ey += 6;
    if (ey + 20 > PAGE_BOT) { pdf.addPage('letter', 'landscape'); addPageHeader(pdf, 'Equipment List', pageW); ey = 46; }
    pdf.setFillColor(241, 245, 249);
    pdf.rect(margin, ey, contentW, 18, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(30, 41, 59);
    // Count racks by type + size e.g. "Vertical 6U ×3  ·  Wall Mount 2U ×4"
    const rackBuckets = {};
    racks.forEach(r => {
      const type  = r.rack_type === 'wall-mount' ? 'Wall Mount' : r.rack_type === 'community' ? 'Community' : 'Vertical';
      const uSize = (r.u_size || '?') + 'U';
      const key   = `${type} ${uSize}`;
      rackBuckets[key] = (rackBuckets[key] || 0) + 1;
    });
    const rackSummary = Object.entries(rackBuckets)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([k,v]) => `${k} ×${v}`)
      .join('     ');
    pdf.text(`RACKS — ${rackSummary}`, margin + 8, ey + 12);
    // Device type counts
    const typeCounts = {};
    devices.forEach(d => { typeCounts[d.device_key] = (typeCounts[d.device_key] || 0) + 1; });
    // Build friendly name map from DEVICE_OPTS labels
    const friendlyName = {
      'UCG-Fiber': 'UCG-Fiber', 'USW-Mission-Critical': 'Mission Critical',
      'USW-Pro-Max-48': 'USW-Pro-Max-48', 'USW-Pro-Max-24': 'USW-Pro-Max-24',
      'USW-Pro-Max-16': 'USW-Pro-Max-16', 'USW-Flex-Mini': 'USW-Flex-Mini',
      'USW-Ultra': 'USW-Ultra', 'UUPS-PRO': 'UniFi UPS Pro', 'UUPS-TOWER': 'UniFi UPS Tower',
    };
    const typeStr = Object.entries(typeCounts)
      .sort((a,b) => b[1] - a[1])
      .map(([k,v]) => `${friendlyName[k] || k}  ×${v}`)
      .join('     ');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(30, 41, 59);
    const typeLines = pdf.splitTextToSize(`EQUIPMENT — ${typeStr}`, contentW - 16);
    pdf.text(typeLines, margin + 8, ey + 24);
  }

  // ── PAGES: Port Mapper ───────────────────────────────────────────────────
  statusMsg('Building port maps (' + sites.length + ' sites, ' + racks.length + ' racks, ' + ports.length + ' ports)…');
  await new Promise(r => setTimeout(r, 50)); // let UI update

  const ROW_H  = 14;
  const COL_GAP = 10;

  // ── layout helpers (closures over mutable state object) ─────────────────
  const colW  = (contentW - COL_GAP) / 2;
  const colXL = margin;
  const colXR = margin + colW + COL_GAP;
  const colYStart = 46;
  // State object passed into helpers so they share mutable references
  const S = { colY: [colYStart, colYStart], curCol: 0, siteName: '' };

  const getX    = () => S.curCol === 0 ? colXL : colXR;
  const getCurY = () => S.colY[S.curCol];
  const setCurY = v  => { S.colY[S.curCol] = v; };

  const ensureRoom = needed => {
    if (S.colY[S.curCol] + needed <= PAGE_BOT) return;
    if (S.curCol === 0) {
      S.curCol = 1;
      if (S.colY[S.curCol] + needed <= PAGE_BOT) return;
    }
    pdf.addPage('letter', 'landscape');
    addPageHeader(pdf, 'Port Map — ' + S.siteName + ' (cont.)', pageW);
    S.colY = [colYStart, colYStart];
    S.curCol = 0;
  };

  const drawDevHeader = (dev, portCount) => {
    const x = getX(), y = getCurY();
    pdf.setFillColor(236, 242, 250);
    pdf.rect(x, y, colW, 14, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
    pdf.setTextColor(30, 41, 59);
    pdf.text((dev.label || '').slice(0, 34), x + 4, y + 10);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(portCount + ' ports', x + colW - 4, y + 10, { align: 'right' });
    setCurY(y + 15);
    const y2 = getCurY();
    pdf.setFontSize(6); pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(148, 163, 184);
    pdf.text('PORT', x + 4, y2 + 7);
    pdf.text('JACK', x + 30, y2 + 7);
    pdf.text('CONNECTED DEVICE', x + 82, y2 + 7);
    pdf.text('STATUS', x + colW - 46, y2 + 7);
    setCurY(y2 + 11);
  };

  const drawPortRow = (p, deviceKey) => {
    const x = getX(), y = getCurY();
    const st  = STATUS_COLOR[p.status] || STATUS_COLOR.unused;
    const poe = getPoE(deviceKey, p.port_num);
    if (p.port_num % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(x, y, colW, ROW_H, 'F'); }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(30, 41, 59);
    pdf.text(String(p.port_num), x + 24, y + 10, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(71, 85, 105);
    if (p.jack_label) pdf.text(p.jack_label.slice(0, 10), x + 30, y + 10);
    pdf.setTextColor(30, 41, 59);
    // Connected device — shorten to leave room for PoE badge
    const devTextMax = poe ? 22 : 28;
    if (p.connected_device) pdf.text(p.connected_device.slice(0, devTextMax), x + 82, y + 10);
    // PoE badge (before status badge)
    if (poe) {
      const [pr, pg, pb] = hexToRgb(poe.bg); const [ptr, ptg, ptb] = hexToRgb(poe.color);
      pdf.setFillColor(pr, pg, pb);
      pdf.roundedRect(x + colW - 90, y + 2.5, 38, 10, 2, 2, 'F');
      pdf.setTextColor(ptr, ptg, ptb); pdf.setFontSize(6); pdf.setFont('helvetica', 'bold');
      pdf.text(poe.label, x + colW - 71, y + 9.5, { align: 'center' });
    }
    // Status badge
    const [rb, gb, bb] = hexToRgb(st.bg); const [rt, gt, bt] = hexToRgb(st.text);
    pdf.setFillColor(rb, gb, bb);
    pdf.roundedRect(x + colW - 46, y + 2.5, 40, 10, 2, 2, 'F');
    pdf.setTextColor(rt, gt, bt); pdf.setFontSize(6.5); pdf.setFont('helvetica', 'bold');
    pdf.text(st.label, x + colW - 26, y + 9.5, { align: 'center' });
    if (p.notes) {
      pdf.setFont('helvetica', 'italic'); pdf.setFontSize(5.5); pdf.setTextColor(148, 163, 184);
      pdf.text(p.notes.slice(0, 20), x + colW - 4, y + 10, { align: 'right' });
    }
    setCurY(y + ROW_H);
  };

  for (const site of sites) {
    const siteRacks = racks.filter(r => r.site_id === site.id);
    statusMsg('Processing ' + site.name + ' (' + siteRacks.length + ' racks)…');
    await new Promise(r => setTimeout(r, 30));
    if (siteRacks.length === 0) continue;

    // Reset layout state for each site
    S.siteName = site.name;
    S.colY = [colYStart, colYStart];
    S.curCol = 0;

    pdf.addPage('letter', 'landscape');
    addPageHeader(pdf, 'Port Map — ' + site.name, pageW);

    // ── render ──────────────────────────────────────────────────────────
    for (const rack of siteRacks) {
      const rackDevices = devices
        .filter(d => d.rack_id === rack.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (rackDevices.length === 0) continue;

      ensureRoom(36);
      const rx = getX();
      pdf.setFillColor(27, 58, 107);
      pdf.roundedRect(rx, getCurY(), colW, 16, 3, 3, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
      pdf.text(rack.name + '  (' + (rack.u_size || '?') + 'U)', rx + 6, getCurY() + 11);
      setCurY(getCurY() + 20);

      for (const dev of rackDevices) {
        const devPorts = ports
          .filter(p => p.device_id === dev.id)
          .sort((a, b) => a.port_num - b.port_num);

        ensureRoom(26 + ROW_H);
        drawDevHeader(dev, devPorts.length);

        for (const p of devPorts) {
          const prevCol = S.curCol;
          const prevY   = getCurY();
          ensureRoom(ROW_H);
          if (S.curCol !== prevCol || getCurY() !== prevY) {
            drawDevHeader(dev, devPorts.length);
          }
          drawPortRow(p, dev.device_key);
        }
        setCurY(getCurY() + 4); // gap between devices
      }
      setCurY(getCurY() + 8); // gap between racks
    }
  }

    // ── PAGE: Port Guide — Device Rules ──────────────────────────────────────
  statusMsg('Adding port guide…');
  pdf.addPage('letter', 'landscape');
  addPageHeader(pdf, 'Port Guide — Device Rules', pageW);

  let y = 46;
  // Better column proportions — Device, Switch, Port hint, PoE, Reason (wider)
  const cD = margin, cSW = margin + 150, cPH = margin + 300, cPE = margin + 430, cR = margin + 490;
  pdf.setFillColor(27, 58, 107);
  pdf.rect(margin, y, contentW, 16, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(200, 220, 255);
  [['DEVICE', cD], ['SWITCH TARGET', cSW], ['PORT HINT', cPH], ['POE', cPE], ['REASON', cR]].forEach(([h, x]) => {
    pdf.text(h, x + 4, y + 11);
  });
  y += 20;

  for (let ri = 0; ri < rules.length; ri++) {
    const r = rules[ri];
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    const reasonMaxW = contentW - (cR - margin) - 8;
    const reasonLines = pdf.splitTextToSize(r.reason || '', reasonMaxW);
    const rowH = Math.max(16, reasonLines.length * 9 + 6);

    if (y + rowH > pageH - 16) {
      pdf.addPage('letter', 'landscape');
      addPageHeader(pdf, 'Port Guide — Device Rules (cont.)', pageW);
      y = 46;
    }

    if (ri % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(margin, y, contentW, rowH, 'F'); }

    const midY = y + rowH / 2 + 2.5;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(30, 41, 59);
    pdf.text((r.device_name || '').slice(0, 20), cD + 4, midY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text((r.switch_target || '').slice(0, 18), cSW + 4, midY);
    pdf.text((r.port_hint || '').slice(0, 18), cPH + 4, midY);

    // PoE badge
    const ps = POE_STYLE[r.poe_req] || POE_STYLE['None'];
    const [pr, pg, pb] = hexToRgb(ps.bg);
    const [ptr, ptg, ptb] = hexToRgb(ps.color);
    pdf.setFillColor(pr, pg, pb);
    pdf.roundedRect(cPE + 2, y + rowH / 2 - 5, 50, 10, 2, 2, 'F');
    pdf.setTextColor(ptr, ptg, ptb);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text(r.poe_req || '—', cPE + 27, y + rowH / 2 + 2.5, { align: 'center' });

    // Reason — wrapped, full width
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(30, 41, 59);
    pdf.text(reasonLines, cR + 4, y + 9);

    y += rowH + 2;
  }

  // ── PAGE: PoE Reference ───────────────────────────────────────────────────
  pdf.addPage('letter', 'landscape');
  addPageHeader(pdf, 'Port Guide — PoE Reference', pageW);
  y = 46;

  const cards = Object.entries(SWITCH_POE);
  const cardGap = 8;
  const cardW   = (contentW - (cards.length - 1) * cardGap) / cards.length;
  // Fixed column offsets within each card (relative to cx)
  const cPorts = 4, cSpeed = 28, cPoe = 58, cWatts = 108;
  const poeW   = 44; // badge width

  for (let ci = 0; ci < cards.length; ci++) {
    const [name, sw] = cards[ci];
    const cx = margin + ci * (cardW + cardGap);

    pdf.setFillColor(27, 58, 107);
    pdf.roundedRect(cx, y, cardW, 20, 3, 3, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text(name, cx + cardW / 2, y + 13, { align: 'center' });

    let ry = y + 26;
    // Column header row
    pdf.setFillColor(248, 250, 252);
    pdf.rect(cx, ry, cardW, 12, 'F');
    pdf.setTextColor(148, 163, 184);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6);
    [['PORTS', cPorts], ['SPEED', cSpeed], ['PoE', cPoe], ['WATTS', cWatts]].forEach(([h, x]) => {
      pdf.text(h, cx + x, ry + 8.5);
    });
    ry += 14;

    for (const row of sw.rows) {
      const ps = POE_STYLE[row.poe] || POE_STYLE['None'];
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(30, 41, 59);
      pdf.text(row.ports, cx + cPorts, ry + 8);
      pdf.text(row.speed, cx + cSpeed, ry + 8);

      // PoE badge
      const [pr, pg, pb]    = hexToRgb(ps.bg);
      const [ptr, ptg, ptb] = hexToRgb(ps.color);
      pdf.setFillColor(pr, pg, pb);
      pdf.roundedRect(cx + cPoe, ry + 1.5, poeW, 10, 2, 2, 'F');
      pdf.setTextColor(ptr, ptg, ptb);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.text(row.poe, cx + cPoe + poeW / 2, ry + 8.5, { align: 'center' });

      // Watts
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(71, 85, 105);
      pdf.text(row.watts, cx + cWatts, ry + 8);
      ry += 13;

      // Note on its own indented line
      if (row.note) {
        pdf.setTextColor(124, 58, 237);
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(6.5);
        pdf.text('↳ ' + row.note, cx + cPoe, ry + 7);
        ry += 11;
      }
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  statusMsg('Saving PDF…');
  const date = new Date().toISOString().slice(0, 10);
  const fname = siteName ? `${siteName.replace(/\s+/g,'-')}-${date}.pdf` : `sage-port-mapper-${date}.pdf`;
  
  // Use blob URL download to bypass popup blockers
  try {
    const blob = pdf.output('blob');
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
  } catch (e) {
    // Fallback to standard save
    pdf.save(fname);
  }
  statusMsg('');
  } catch (err) {
    console.error('Export failed:', err);
    statusMsg('');
    alert('Export failed: ' + (err?.message || 'Unknown error. Check console for details.'));
  }
}

// ── PoE type from device key + port number ───────────────────────────────────
const DEVICE_POE = {
  'UCG-Fiber':            { poe_plus: [2,3,4,5,6,7,8], poe_pp: [1], sfp: [] },
  'USW-Mission-Critical': { poe_plus: [1,2,3,4,5,6,7,8], poe_pp: [], sfp: [9] },
  'USW-Pro-Max-48':       { poe_plus: Array.from({length:32},(_,i)=>i+1), poe_pp: Array.from({length:16},(_,i)=>i+33), sfp: [49,50,51,52] },
  'USW-Pro-Max-24':       { poe_plus: Array.from({length:16},(_,i)=>i+1), poe_pp: Array.from({length:8}, (_,i)=>i+17), sfp: [25,26] },
  'USW-Pro-Max-16':       { poe_plus: Array.from({length:12},(_,i)=>i+1), poe_pp: Array.from({length:4}, (_,i)=>i+13), sfp: [17,18] },
  'USW-Flex-Mini':        { poe_plus: [1,2,3,4,5], poe_pp: [], sfp: [] },
  'USW-Ultra':            { poe_plus: [1,2,3,4,5,6,7], poe_pp: [], sfp: [] },
};
function getPoE(deviceKey, portNum) {
  const d = DEVICE_POE[deviceKey];
  if (!d) return null;
  if (d.sfp.includes(portNum))      return { label: 'SFP+', bg: '#f1f5f9', color: '#475569' };
  if (d.poe_pp.includes(portNum))   return { label: 'PoE++', bg: '#ede9fe', color: '#6d28d9' };
  if (d.poe_plus.includes(portNum)) return { label: 'PoE+',  bg: '#dbeafe', color: '#1e40af' };
  return null;
}

// ── hex → rgb helper ─────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
