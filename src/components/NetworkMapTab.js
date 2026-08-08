import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, canWrite } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const NODE_TYPES = {
  mdf:           { label: 'MDF / UCG Fiber',    fill: '#4c1d95', stroke: '#a78bfa', text: '#fff', badge: '#c4b5fd', w: 150, h: 60 },
  idf:           { label: 'IDF',                fill: '#1B3A6B', stroke: '#60a5fa', text: '#fff', badge: '#93c5fd', w: 140, h: 54 },
  mc:            { label: 'Mission Critical',   fill: '#1e40af', stroke: '#93c5fd', text: '#fff', badge: '#bfdbfe', w: 130, h: 50 },
  flex:          { label: 'Flex Switch',        fill: '#065f46', stroke: '#6ee7b7', text: '#fff', badge: '#a7f3d0', w: 120, h: 46 },
  patch:         { label: 'Patch Panel',        fill: '#166534', stroke: '#86efac', text: '#fff', badge: '#bbf7d0', w: 120, h: 46 },
  ups:           { label: 'UPS / PDU',          fill: '#374151', stroke: '#d1d5db', text: '#fff', badge: '#e5e7eb', w: 110, h: 46 },
  backbone_only: { label: 'Backbone Only',      fill: '#7c3aed', stroke: '#c4b5fd', text: '#fff', badge: '#ddd6fe', w: 140, h: 54 },
  passthrough:   { label: 'Passthrough Room',   fill: '#0891b2', stroke: '#67e8f9', text: '#fff', badge: '#a5f3fc', w: 140, h: 54 },
};
const LINK_STYLES = {
  backbone: { color: '#7c3aed', width: 2.5, dash: [] },
  internal: { color: '#0891b2', width: 1.5, dash: [6, 4] },
  fiber:    { color: '#7c3aed', width: 2,   dash: [3, 3] },
  generic:  { color: '#94a3b8', width: 1.5, dash: [] },
};

export default function NetworkMapTab({ mapCanvasRef }) {
  const { profile } = useAuth();
  const write = canWrite(profile?.role);
  const internalRef = useRef(null);
  const canvasRef = mapCanvasRef || internalRef;
  const [sites, setSites]   = useState([]);
  const [nodes, setNodes]   = useState([]);
  const [links, setLinks]   = useState([]);
  const [selNode, setSelNode] = useState(null);
  const [siteFilter, setSiteFilter] = useState('all');
  const moveMode = true; // always draggable
  const [modal, setModal]   = useState(null);
  const [popup, setPopup]   = useState(null); // {node, x, y}
  const pan   = useRef({ x: 60, y: 60 });
  const zoom  = useRef(1);
  const dragging = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const movingNode = useRef(null);
  const lastMouse  = useRef({ x: 0, y: 0 });

  useEffect(() => {
    loadAllData();

    // Realtime — listen for changes
    const nodeChannel = supabase
      .channel('map_nodes_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'map_nodes' },
        payload => setNodes(prev => prev.find(n => n.id === payload.new.id) ? prev : [...prev, payload.new])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'map_nodes' },
        payload => setNodes(prev => prev.map(n => n.id === payload.new.id ? payload.new : n))
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'map_nodes' },
        payload => setNodes(prev => prev.filter(n => n.id !== payload.old.id))
      )
      .subscribe();

    const linkChannel = supabase
      .channel('map_links_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'map_links' },
        payload => setLinks(prev => prev.find(l => l.id === payload.new.id) ? prev : [...prev, payload.new])
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'map_links' },
        payload => setLinks(prev => prev.filter(l => l.id !== payload.old.id))
      )
      .subscribe();

    return () => {
      supabase.removeChannel(nodeChannel);
      supabase.removeChannel(linkChannel);
    };
  }, []);

  async function loadAllData() {
    const [sitesRes, nodesRes, linksRes, racksRes] = await Promise.all([
      supabase.from('sites').select('*'),
      supabase.from('map_nodes').select('*'),
      supabase.from('map_links').select('*'),
      supabase.from('racks').select('*'),
    ]);

    const sitesData  = sitesRes.data  || [];
    const nodesData  = nodesRes.data  || [];
    const linksData  = linksRes.data  || [];
    const racksData  = racksRes.data  || [];

    setSites(sitesData);
    setLinks(linksData);

    // Just load nodes as-is — manual creation only via "+ Node" button
    setNodes(nodesData);
  }

  const visibleNodes = nodes.filter(n => siteFilter === 'all' || n.site_id === siteFilter || !n.site_id);

  const draw = useCallback((overrideNodes, overrideLinks) => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const drawNodes = overrideNodes || visibleNodes;
    const drawLinks = overrideLinks || links;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(pan.current.x, pan.current.y);
    ctx.scale(zoom.current, zoom.current);
    const z = zoom.current;

    // grid
    ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1 / z;
    const gs = 50, ox = (-pan.current.x / z) % gs, oy = (-pan.current.y / z) % gs;
    for (let x = -gs + ox; x < W / z + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, -H); ctx.lineTo(x, H * 2); ctx.stroke(); }
    for (let y = -gs + oy; y < H / z + gs; y += gs) { ctx.beginPath(); ctx.moveTo(-W, y); ctx.lineTo(W * 2, y); ctx.stroke(); }

    const nodeMap = Object.fromEntries(drawNodes.map(n => [n.id, n]));

    // Build label-offset index — for links sharing the same node pair,
    // assign each a vertical slot so their pills don't overlap
    const pairCount = {}, pairIdx = {};
    drawLinks.forEach(lnk => {
      const key = [lnk.from_id, lnk.to_id].sort().join('|');
      pairCount[key] = (pairCount[key] || 0) + 1;
    });
    const pairSeen = {};
    drawLinks.forEach(lnk => {
      const key = [lnk.from_id, lnk.to_id].sort().join('|');
      pairIdx[lnk.id] = pairSeen[key] || 0;
      pairSeen[key] = (pairSeen[key] || 0) + 1;
    });

    // ── Facility lanes (only in "all" view) ─────────────────────────────────
    if (siteFilter === 'all' && sites.length > 1) {
      const LANE_PAD = 60;
      const LANE_COLORS = [
        'rgba(59,130,246,0.06)', 'rgba(16,185,129,0.06)', 'rgba(139,92,246,0.06)',
        'rgba(245,158,11,0.06)', 'rgba(239,68,68,0.06)',  'rgba(14,165,233,0.06)',
      ];
      const BORDER_COLORS = [
        'rgba(59,130,246,0.25)', 'rgba(16,185,129,0.25)', 'rgba(139,92,246,0.25)',
        'rgba(245,158,11,0.25)', 'rgba(239,68,68,0.25)',  'rgba(14,165,233,0.25)',
      ];

      sites.forEach((site, si) => {
        const siteNodes = drawNodes.filter(n => n.site_id === site.id);
        if (siteNodes.length === 0) return;

        const xs = siteNodes.map(n => n.pos_x);
        const ys = siteNodes.map(n => n.pos_y);
        const minX = Math.min(...xs) - LANE_PAD;
        const maxX = Math.max(...xs) + LANE_PAD;
        const minY = Math.min(...ys) - LANE_PAD;
        const maxY = Math.max(...ys) + LANE_PAD;
        const lw = maxX - minX, lh = maxY - minY;
        const col = si % LANE_COLORS.length;

        // Lane background
        ctx.fillStyle = LANE_COLORS[col];
        ctx.beginPath();
        rrect(ctx, minX, minY, lw, lh, 12 / z);
        ctx.fill();

        // Lane border
        ctx.strokeStyle = BORDER_COLORS[col];
        ctx.lineWidth = 1.5 / z;
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.beginPath();
        rrect(ctx, minX, minY, lw, lh, 12 / z);
        ctx.stroke();
        ctx.setLineDash([]);

        // Facility label banner at top of lane
        const bannerH = 22 / z;
        ctx.fillStyle = BORDER_COLORS[col].replace('0.25', '0.5');
        ctx.beginPath();
        rrect(ctx, minX, minY, lw, bannerH, 12 / z);
        ctx.fill();

        ctx.font = `600 ${11 / z}px sans-serif`;
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'left';
        ctx.fillText(site.name, minX + 10 / z, minY + bannerH * 0.72);
        ctx.font = `${9 / z}px sans-serif`;
        ctx.fillStyle = '#64748b';
        ctx.fillText(`${siteNodes.length} nodes`, minX + lw - 8 / z, minY + bannerH * 0.72);
        // oops — right-align node count
        ctx.textAlign = 'right';
        ctx.fillText(`${siteNodes.length} nodes`, minX + lw - 8 / z, minY + bannerH * 0.72);
      });
    }

    // links — spread ports across each node's width, then draw smooth bezier
    // curves so every link has a visually distinct path.
    const portMap = {};
    drawLinks.forEach(lnk => {
      if (!nodeMap[lnk.from_id] || !nodeMap[lnk.to_id]) return;
      (portMap[lnk.from_id] = portMap[lnk.from_id] || []).push(lnk.id);
      (portMap[lnk.to_id]   = portMap[lnk.to_id]   || []).push(lnk.id);
    });

    function portX(nid, lid) {
      const node = nodeMap[nid]; if (!node) return 0;
      const nt   = NODE_TYPES[node.type] || NODE_TYPES.idf;
      const list = portMap[nid] || [];
      const idx  = list.indexOf(lid);
      const count = list.length;
      if (count <= 1) return node.pos_x;
      const span = nt.w * 0.75;
      return node.pos_x - span / 2 + (span / (count - 1)) * idx;
    }

    drawLinks.forEach(lnk => {
      const from = nodeMap[lnk.from_id], to = nodeMap[lnk.to_id];
      if (!from || !to) return;
      const ls   = LINK_STYLES[lnk.link_type] || LINK_STYLES.generic;
      const isSel = selNode && (lnk.from_id === selNode || lnk.to_id === selNode);
      const ntF  = NODE_TYPES[from.type] || NODE_TYPES.idf;
      const ntT  = NODE_TYPES[to.type]   || NODE_TYPES.idf;
      const fx   = portX(lnk.from_id, lnk.id);
      const tx   = portX(lnk.to_id,   lnk.id);
      const fromBelow = from.pos_y <= to.pos_y;
      const fy   = fromBelow ? from.pos_y + ntF.h / 2 : from.pos_y - ntF.h / 2;
      const ty   = fromBelow ? to.pos_y   - ntT.h / 2 : to.pos_y   + ntT.h / 2;
      // Orthogonal routing: drop straight down from exit port, then
      // travel horizontally at a midpoint Y, then straight up into entry port.
      // The portX spread already gives each link a unique fx/tx so the
      // vertical segments never overlap.
      ctx.beginPath();
      if (Math.abs(fx - tx) < 2) {
        // perfectly vertical — just a straight line
        ctx.moveTo(fx, fy); ctx.lineTo(tx, ty);
      } else {
        const my = (fy + ty) / 2;
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx, my);
        ctx.lineTo(tx, my);
        ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = isSel ? '#f59e0b' : ls.color;
      ctx.lineWidth = (isSel ? 3 : ls.width) / z;
      ctx.setLineDash(ls.dash.map(d => d / z));
      ctx.stroke(); ctx.setLineDash([]);
      const al = 8 / z;
      ctx.beginPath(); ctx.moveTo(tx - al / 2, ty - al); ctx.lineTo(tx, ty); ctx.lineTo(tx + al / 2, ty - al);
      ctx.strokeStyle = isSel ? '#f59e0b' : ls.color; ctx.lineWidth = 1.5 / z; ctx.stroke();
      if (lnk.label) {
        // Offset each label vertically based on its index among same-pair links
        const pKey = [lnk.from_id, lnk.to_id].sort().join('|');
        const pTotal = pairCount[pKey] || 1;
        const pI     = pairIdx[lnk.id] || 0;
        const SLOT_H = 22 / z;
        const lx = fx + (tx - fx) * 0.35;
        const lyBase = (fy + ty) / 2;
        const ly = lyBase + (pI - (pTotal - 1) / 2) * SLOT_H;
        const fontSize = 11 / z;
        ctx.font = `600 ${fontSize}px sans-serif`;
        const MAX_CHARS = 32;
        const displayLabel = lnk.label.length > MAX_CHARS
          ? lnk.label.slice(0, MAX_CHARS) + '…'
          : lnk.label;
        const tw = ctx.measureText(displayLabel).width;
        const ph = fontSize * 1.7;
        const pw = tw + 16 / z;
        const pr = ph / 2;
        const lxAdj = lx, lyAdj = ly - ph / 2 - 4 / z;
        // Drop shadow
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 4 / z;
        // Pill background
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(lxAdj - pw/2 + pr, lyAdj);
        ctx.lineTo(lxAdj + pw/2 - pr, lyAdj);
        ctx.arcTo(lxAdj + pw/2, lyAdj, lxAdj + pw/2, lyAdj + pr, pr);
        ctx.lineTo(lxAdj + pw/2, lyAdj + ph - pr);
        ctx.arcTo(lxAdj + pw/2, lyAdj + ph, lxAdj + pw/2 - pr, lyAdj + ph, pr);
        ctx.lineTo(lxAdj - pw/2 + pr, lyAdj + ph);
        ctx.arcTo(lxAdj - pw/2, lyAdj + ph, lxAdj - pw/2, lyAdj + ph - pr, pr);
        ctx.lineTo(lxAdj - pw/2, lyAdj + pr);
        ctx.arcTo(lxAdj - pw/2, lyAdj, lxAdj - pw/2 + pr, lyAdj, pr);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        // Colored border
        ctx.strokeStyle = ls.color;
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
        // Text
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.fillText(displayLabel, lxAdj, lyAdj + ph * 0.68);
      }
    });

    // nodes
    drawNodes.forEach(n => {
      const nt = NODE_TYPES[n.type] || NODE_TYPES.idf;
      const hw = nt.w / 2, hh = nt.h / 2;
      const x = n.pos_x - hw, y = n.pos_y - hh;
      const isSel = selNode === n.id;
      ctx.shadowColor = 'rgba(0,0,0,.15)'; ctx.shadowBlur = (isSel ? 16 : 7) / z;
      ctx.beginPath(); rrect(ctx, x, y, nt.w, nt.h, 5 / z);
      ctx.fillStyle = nt.fill; ctx.fill();
      ctx.strokeStyle = isSel ? '#fbbf24' : nt.stroke; ctx.lineWidth = (isSel ? 3 : 1.5) / z; ctx.stroke();
      ctx.shadowBlur = 0;
      const bw = nt.w * 0.6, bh = 14 / z, bx = x + 6 / z, by = y - bh / 2;
      ctx.beginPath(); rrect(ctx, bx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
      ctx.font = `600 ${8 / z}px sans-serif`; ctx.fillStyle = nt.badge; ctx.textAlign = 'left';
      ctx.fillText((NODE_TYPES[n.type]?.label || n.type).toUpperCase(), bx + 5 / z, by + bh * 0.72);
      ctx.font = `600 ${12 / z}px sans-serif`; ctx.fillStyle = nt.text; ctx.textAlign = 'center';
      ctx.fillText(n.label, n.pos_x, n.pos_y + 2 / z);
      if (n.sub_label) { ctx.font = `${9 / z}px sans-serif`; ctx.fillStyle = nt.badge; ctx.fillText(n.sub_label, n.pos_x, n.pos_y + hh - 6 / z); }
    });
    ctx.restore();

    // Expose pan/zoom to ExportPDF via data attributes
    cv.dataset.panX = pan.current.x;
    cv.dataset.panY = pan.current.y;
    cv.dataset.zoom = zoom.current;
  }, [visibleNodes, links, selNode]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const wrap = cv.parentElement;
    cv.width = wrap.clientWidth; cv.height = wrap.clientHeight;
    draw();
    const ro = new ResizeObserver(() => { cv.width = wrap.clientWidth; cv.height = wrap.clientHeight; draw(); });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // Redraw whenever nodes or links change
  useEffect(() => { draw(); }, [nodes, links, draw]);

  // Attach wheel listener with passive:false so preventDefault works
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Auto-fit whenever nodes load or change — arrange only if all at 0,0
  useEffect(() => {
    if (nodes.length === 0) return;
    // Small delay so canvas dimensions are stable
    const t = setTimeout(() => {
      const allUnpositioned = nodes.every(n => !n.pos_x && !n.pos_y);
      if (allUnpositioned) { autoArrange(); } else { fitAll(); }
    }, 150);
    return () => clearTimeout(t);
  }, [nodes.length]);

  function w2c(cx, cy) { return { x: (cx - pan.current.x) / zoom.current, y: (cy - pan.current.y) / zoom.current }; }
  function nodeAt(wx, wy) {
    for (let i = visibleNodes.length - 1; i >= 0; i--) {
      const n = visibleNodes[i]; const nt = NODE_TYPES[n.type] || NODE_TYPES.idf;
      if (wx >= n.pos_x - nt.w / 2 && wx <= n.pos_x + nt.w / 2 && wy >= n.pos_y - nt.h / 2 && wy <= n.pos_y + nt.h / 2) return n;
    } return null;
  }

  function onMouseDown(e) {
    const { x, y } = w2c(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    const n = nodeAt(x, y);
    if (moveMode && n && write) { movingNode.current = n; lastMouse.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }; }
    else if (!n) { dragging.current = true; panStart.current = { x: e.nativeEvent.offsetX - pan.current.x, y: e.nativeEvent.offsetY - pan.current.y }; }
  }
  function onMouseMove(e) {
    if (movingNode.current) {
      const dx = (e.nativeEvent.offsetX - lastMouse.current.x) / zoom.current;
      const dy = (e.nativeEvent.offsetY - lastMouse.current.y) / zoom.current;
      movingNode.current.pos_x += dx; movingNode.current.pos_y += dy;
      lastMouse.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      setNodes(ns => [...ns]); draw(); return;
    }
    if (dragging.current) { pan.current = { x: e.nativeEvent.offsetX - panStart.current.x, y: e.nativeEvent.offsetY - panStart.current.y }; clampPan(); draw(); }
  }
  async function onMouseUp(e) {
    if (movingNode.current) {
      const n = movingNode.current;
      await supabase.from('map_nodes').update({ pos_x: n.pos_x, pos_y: n.pos_y }).eq('id', n.id);
      movingNode.current = null;
    }
    dragging.current = false;
  }
  function onClick(e) {
    const { x, y } = w2c(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    const n = nodeAt(x, y);
    if (n) { setSelNode(n.id); setPopup({ node: n, x: e.nativeEvent.offsetX + 14, y: e.nativeEvent.offsetY - 10 }); }
    else { setSelNode(null); setPopup(null); }
    draw();
  }
  function onWheel(e) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 0.91;
    const newZoom = Math.max(0.25, Math.min(3, zoom.current * f));
    pan.current.x = e.nativeEvent.offsetX - (e.nativeEvent.offsetX - pan.current.x) * (newZoom / zoom.current);
    pan.current.y = e.nativeEvent.offsetY - (e.nativeEvent.offsetY - pan.current.y) * (newZoom / zoom.current);
    zoom.current = newZoom;
    clampPan();
    draw();
  }
  function fitAll() {
    if (!visibleNodes.length) return;
    const cv = canvasRef.current;
    const xs = visibleNodes.map(n => n.pos_x), ys = visibleNodes.map(n => n.pos_y);
    const minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 90;
    const minY = Math.min(...ys) - 50, maxY = Math.max(...ys) + 50;
    zoom.current = Math.max(.15, Math.min(2, Math.min(cv.width / (maxX - minX), cv.height / (maxY - minY)) * .88));
    pan.current.x = cv.width / 2 - ((minX + maxX) / 2) * zoom.current;
    pan.current.y = cv.height / 2 - ((minY + maxY) / 2) * zoom.current;
    draw();
  }

  // Clamp pan so nodes can't be scrolled completely off screen.
  // Keeps at least 60px of content visible on each edge.
  function clampPan() {
    if (!visibleNodes.length) return;
    const cv = canvasRef.current;
    const MARGIN = 60;
    const xs = visibleNodes.map(n => n.pos_x), ys = visibleNodes.map(n => n.pos_y);
    const contentMinX = Math.min(...xs) * zoom.current + pan.current.x;
    const contentMaxX = Math.max(...xs) * zoom.current + pan.current.x;
    const contentMinY = Math.min(...ys) * zoom.current + pan.current.y;
    const contentMaxY = Math.max(...ys) * zoom.current + pan.current.y;
    if (contentMaxX < MARGIN)          pan.current.x += MARGIN - contentMaxX;
    if (contentMinX > cv.width - MARGIN)  pan.current.x -= contentMinX - (cv.width - MARGIN);
    if (contentMaxY < MARGIN)          pan.current.y += MARGIN - contentMaxY;
    if (contentMinY > cv.height - MARGIN) pan.current.y -= contentMinY - (cv.height - MARGIN);
  }
  function autoArrange() {
    const cv = canvasRef.current;
    const W = cv?.width || 900, H = cv?.height || 600;
    const allVisible = visibleNodes.map(n => ({...n}));

    if (siteFilter === 'all' && sites.length > 1) {
      // Side-by-side layout — one column per facility, separated by 80px gap
      const LANE_W   = 360;
      const LANE_GAP = 80;
      const activeSites = sites.filter(s => allVisible.some(n => n.site_id === s.id));

      activeSites.forEach((site, si) => {
        const sNodes = allVisible.filter(n => n.site_id === site.id);
        const laneX  = si * (LANE_W + LANE_GAP) + LANE_W / 2 + 40;
        const mdfs   = sNodes.filter(n => n.type === 'mdf');
        const idfs   = sNodes.filter(n => n.type === 'idf');
        const rest   = sNodes.filter(n => n.type !== 'mdf' && n.type !== 'idf');

        mdfs.forEach((n, i) => {
          n.pos_x = laneX + (i - (mdfs.length - 1) / 2) * 160;
          n.pos_y = 120;
        });
        const idfSp = Math.min(160, (LANE_W - 40) / Math.max(idfs.length, 1));
        idfs.forEach((n, i) => {
          n.pos_x = laneX + (i - (idfs.length - 1) / 2) * idfSp;
          n.pos_y = 280;
        });
        rest.forEach((n, i) => {
          n.pos_x = laneX + (i - (rest.length - 1) / 2) * 140;
          n.pos_y = 440;
        });
      });
    } else {
      // Single-site layout
      const mdfs  = allVisible.filter(n => n.type === 'mdf');
      const idfs  = allVisible.filter(n => n.type === 'idf');
      const rest  = allVisible.filter(n => n.type !== 'mdf' && n.type !== 'idf');

      mdfs.forEach((n, i) => {
        n.pos_x = W / 2 + (i - (mdfs.length - 1) / 2) * 220;
        n.pos_y = 120;
      });
      const idfSpacing = Math.min(200, (W - 80) / Math.max(idfs.length, 1));
      const idfStartX  = W / 2 - (idfSpacing * (idfs.length - 1)) / 2;
      idfs.forEach((n, i) => {
        n.pos_x = idfStartX + i * idfSpacing;
        n.pos_y = 300;
      });
      rest.forEach((n, i) => {
        n.pos_x = W / 2 + (i - (rest.length - 1) / 2) * 180;
        n.pos_y = 460;
      });
    }

    // Update state with new positions
    setNodes(prev => prev.map(n => {
      const updated = allVisible.find(v => v.id === n.id);
      return updated ? { ...n, pos_x: updated.pos_x, pos_y: updated.pos_y } : n;
    }));

    // Draw immediately with updated positions
    draw(allVisible, links);

    // Fit to view
    const xs = allVisible.map(n => n.pos_x);
    const ys = allVisible.map(n => n.pos_y);
    if (xs.length) {
      setTimeout(() => {
        const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100;
        const minY = Math.min(...ys) - 70,  maxY = Math.max(...ys) + 70;
        zoom.current = Math.max(.15, Math.min(2, Math.min(W / (maxX - minX), H / (maxY - minY)) * .88));
        pan.current.x = W / 2 - ((minX + maxX) / 2) * zoom.current;
        pan.current.y = H / 2 - ((minY + maxY) / 2) * zoom.current;
        draw(allVisible, links);
      }, 50);
    }

    // Note: auto-arrange is view-only — positions are NOT saved to DB.
    // Manual drag-to-position saves are handled separately in onMouseUp.
  }

  async function addNode(data) {
    const cv = canvasRef.current;
    const { data: row } = await supabase.from('map_nodes').insert({ ...data, pos_x: (cv?.width || 800) / 2, pos_y: (cv?.height || 600) / 2 }).select().single();
    if (row) setNodes(ns => [...ns, row]);
    setModal(null);
  }
  async function deleteNode(id) {
    if (!window.confirm('Remove node and its links?')) return;
    await supabase.from('map_nodes').delete().eq('id', id);
    await supabase.from('map_links').delete().or(`from_id.eq.${id},to_id.eq.${id}`);
    setNodes(ns => ns.filter(n => n.id !== id));
    setLinks(ls => ls.filter(l => l.from_id !== id && l.to_id !== id));
    setSelNode(null); setPopup(null);
  }
  async function addLink(data) {
    const fromNode = nodes.find(n => n.id === data.from_id);
    const toNode   = nodes.find(n => n.id === data.to_id);
    if (!fromNode || !toNode) return;
    if (fromNode.site_id !== toNode.site_id) {
      alert('Links must be within the same facility. Cross-facility connections are not allowed.');
      return;
    }
    const { data: row } = await supabase.from('map_links').insert(data).select().single();
    if (row) setLinks(ls => [...ls, row]);
    setModal(null);
  }
  async function deleteLink(id) {
    await supabase.from('map_links').delete().eq('id', id);
    setLinks(ls => ls.filter(l => l.id !== id));
    setPopup(null);
  }


  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 96px)', overflow: 'hidden' }}>
      {/* Sidebar tree */}
      <div style={{ width: 240, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Facilities</span>
          {write && <button style={{ background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 9px', fontSize: 11, cursor: 'pointer' }} onClick={() => setModal({ type: 'addNode' })}>+ Node</button>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {/* "All" option */}
          <div
            onClick={() => { setSiteFilter('all'); setTimeout(fitAll, 80); }}
            style={{ padding: '9px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              background: siteFilter === 'all' ? '#eff6ff' : 'transparent',
              color: siteFilter === 'all' ? '#1d4ed8' : '#475569',
              borderLeft: siteFilter === 'all' ? '3px solid #3b82f6' : '3px solid transparent',
              borderBottom: '1px solid #f1f5f9' }}>
            <i className="ti ti-layout-grid" style={{ fontSize: 13 }} />
            All facilities
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{nodes.length}</span>
          </div>
          {/* One row per site — click to isolate that site on the map */}
          {sites.map(s => {
            const sNodes = nodes.filter(n => n.site_id === s.id);
            const isActive = siteFilter === s.id;
            return (
              <div key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                {/* Site name row — click to show only this site */}
                <div
                  onClick={() => { setSiteFilter(s.id); setTimeout(fitAll, 80); }}
                  style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    background: isActive ? '#eff6ff' : '#fafafa',
                    color: isActive ? '#1d4ed8' : '#334155',
                    borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent' }}>
                  <i className="ti ti-building" style={{ fontSize: 13 }} />
                  {s.name}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{sNodes.length} nodes</span>
                </div>
                {/* Node list — only show when this site is active */}
                {isActive && sNodes.map(n => {
                  const nt = NODE_TYPES[n.type] || NODE_TYPES.idf;
                  return (
                    <div key={n.id}
                      style={{ padding: '7px 14px 7px 28px', fontSize: 11, color: selNode === n.id ? '#1d4ed8' : '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #f8fafc', background: selNode === n.id ? '#eff6ff' : 'transparent' }}
                      onClick={e => { e.stopPropagation(); setSelNode(n.id); const cv = canvasRef.current; pan.current.x = cv.width / 2 - n.pos_x * zoom.current; pan.current.y = cv.height / 2 - n.pos_y * zoom.current; draw(); setPopup({ node: n, x: cv.width / 2 + 80, y: cv.height / 2 - 20 }); }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: nt.fill, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ flex: 1 }}>{n.label}</span>
                      <span style={{ fontSize: 9, color: '#94a3b8' }}>{n.sub_label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fafbfc' }}>
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {siteFilter === 'all' && <button style={mapBtn} onClick={autoArrange}><i className="ti ti-layout-distribute-vertical" /> Auto-arrange</button>}
          <button style={mapBtn} onClick={fitAll}><i className="ti ti-focus-2" /> Fit</button>
          {write && <button style={mapBtn} onClick={() => setModal({ type: 'addLink' })}><i className="ti ti-plug-connected" /> Add link</button>}

        </div>
        <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
          onClick={onClick} onDoubleClick={() => fitAll()} />
        <div style={{ position: 'absolute', bottom: 40, left: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', boxShadow: '0 1px 4px rgba(0,0,0,.06)', maxWidth: 500 }}>
          {[
            { color: '#4c1d95', label: 'MDF / UCG Fiber' },
            { color: '#1B3A6B', label: 'IDF' },
            { color: '#7c3aed', label: 'Backbone Only' },
            { color: '#0891b2', label: 'Passthrough' },
            { color: '#7c3aed', label: 'Backbone link', line: true },
            { color: '#0891b2', label: 'Internal link', line: true, dashed: true },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#475569' }}>
              {item.line
                ? <div style={{ width: 20, height: 2, background: item.color, borderTop: item.dashed ? `2px dashed ${item.color}` : 'none', flexShrink: 0 }} />
                : <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
              }
              {item.label}
            </div>
          ))}
        </div>

        {/* Node popup */}
        {popup && (
          <div style={{ position: 'absolute', left: Math.min(popup.x, (canvasRef.current?.width || 800) - 250), top: Math.min(popup.y, (canvasRef.current?.height || 600) - 320), width: 230, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.13)', zIndex: 20, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: (NODE_TYPES[popup.node.type] || NODE_TYPES.idf).fill, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{popup.node.label}</span>
              <button style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.8)', cursor: 'pointer', fontSize: 17 }} onClick={() => { setPopup(null); setSelNode(null); draw(); }}>×</button>
            </div>
            <div style={{ padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
              {[['Type', (NODE_TYPES[popup.node.type] || NODE_TYPES.idf).label], ['Location', popup.node.sub_label], ['Site', sites.find(s => s.id === popup.node.site_id)?.name]].filter(r => r[1]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f8fafc' }}>
                  <span style={{ color: '#64748b' }}>{k}</span><span style={{ color: '#1e293b', fontWeight: 500 }}>{v}</span>
                </div>
              ))}
              {links.filter(l => l.from_id === popup.node.id || l.to_id === popup.node.id).map(l => {
                const other = nodes.find(n => n.id === (l.from_id === popup.node.id ? l.to_id : l.from_id));
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #f8fafc' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: (LINK_STYLES[l.link_type] || LINK_STYLES.generic).color, display: 'inline-block' }} />
                      {l.link_type}
                    </span>
                    <span style={{ color: '#1e293b', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {other?.label || '?'}
                      {write && <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: 0 }} onClick={() => deleteLink(l.id)}>×</button>}
                    </span>
                  </div>
                );
              })}
              {write && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button style={popBtn} onClick={() => { setModal({ type: 'linkFrom', data: popup.node }); setPopup(null); }}>Link</button>
                  <button style={{ ...popBtn, color: '#dc2626', borderColor: '#fecaca' }} onClick={() => deleteNode(popup.node.id)}>Remove</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '22px 24px', width: 380, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            {modal.type === 'addNode' && <NodeForm sites={sites} onSave={addNode} onClose={() => setModal(null)} />}
            {modal.type === 'addLink' && <LinkForm nodes={nodes} onSave={addLink} onClose={() => setModal(null)} />}
            {modal.type === 'linkFrom' && <LinkForm nodes={nodes} defaultFrom={modal.data?.id} onSave={addLink} onClose={() => setModal(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeForm({ sites, onSave, onClose }) {
  const [label, setLabel]     = useState('');
  const [type, setType]       = useState('idf');
  const [sub, setSub]         = useState('');
  const [siteId, setSiteId]   = useState(sites[0]?.id || '');

  const typeDescriptions = {
    mdf:           'Core switch / UCG Fiber — top of the hierarchy',
    idf:           'Intermediate Distribution Frame — standard rack location',
    mc:            'Mission Critical switch with battery backup',
    flex:          'Flex switch — branches off Mission Critical',
    patch:         'Patch panel only location',
    ups:           'UPS / PDU power unit',
    backbone_only: 'Room with backbone cabling only — no active equipment',
    passthrough:   'Passthrough room — cable runs through, no termination',
  };

  return (<>
    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add node</h3>
    <label style={fl}>Label</label>
    <input style={fi} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. IDF 2" autoFocus />
    <label style={fl}>Type</label>
    <select style={fi} value={type} onChange={e => setType(e.target.value)}>
      <optgroup label="Active Equipment">
        <option value="mdf">MDF / UCG Fiber</option>
        <option value="idf">IDF (standard rack)</option>
        <option value="mc">Mission Critical</option>
        <option value="flex">Flex Switch</option>
      </optgroup>
      <optgroup label="Passive / Infrastructure">
        <option value="patch">Patch Panel</option>
        <option value="ups">UPS / PDU</option>
      </optgroup>
      <optgroup label="Rooms">
        <option value="backbone_only">Backbone Only</option>
        <option value="passthrough">Passthrough Room</option>
      </optgroup>
    </select>
    {type && <div style={{ fontSize: 11, color: '#64748b', marginTop: 5, padding: '6px 8px', background: '#f8fafc', borderRadius: 5, borderLeft: `3px solid ${NODE_TYPES[type]?.stroke || '#e2e8f0'}` }}>
      {typeDescriptions[type]}
    </div>}
    <label style={fl}>Sub-label / location</label>
    <input style={fi} value={sub} onChange={e => setSub(e.target.value)} placeholder="e.g. Wing B" />
    <label style={fl}>Facility</label>
    <select style={fi} value={siteId} onChange={e => setSiteId(e.target.value)}>
      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
    <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
      <button style={fcBtn} onClick={onClose}>Cancel</button>
      <button style={fsBtn} onClick={() => onSave({ label, type, sub_label: sub, site_id: siteId })}>Add node</button>
    </div>
  </>);
}

function LinkForm({ nodes, defaultFrom, onSave, onClose }) {
  const [fromId, setFromId] = useState(defaultFrom || nodes[0]?.id || '');
  const [type,   setType]   = useState('backbone');
  const [label,  setLabel]  = useState('');

  // Only show nodes from the same facility as the selected "from" node
  const fromNode    = nodes.find(n => n.id === fromId);
  const sameSiteNodes = nodes.filter(n => n.site_id === fromNode?.site_id && n.id !== fromId);
  const [toId, setToId] = useState(sameSiteNodes[0]?.id || '');

  // When "from" changes, reset "to" to first valid same-site option
  function handleFromChange(id) {
    setFromId(id);
    const newFrom = nodes.find(n => n.id === id);
    const peers   = nodes.filter(n => n.site_id === newFrom?.site_id && n.id !== id);
    setToId(peers[0]?.id || '');
  }

  const canSave = fromId && toId && fromId !== toId;

  return (<>
    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Add link</h3>
    <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>Links can only connect nodes within the same facility.</p>
    <label style={fl}>From</label>
    <select style={fi} value={fromId} onChange={e => handleFromChange(e.target.value)}>
      {nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
    </select>
    <label style={fl}>To <span style={{ color: '#94a3b8', fontWeight: 400 }}>(same facility only)</span></label>
    <select style={fi} value={toId} onChange={e => setToId(e.target.value)} disabled={sameSiteNodes.length === 0}>
      {sameSiteNodes.length === 0
        ? <option value="">No other nodes in this facility</option>
        : sameSiteNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)
      }
    </select>
    <label style={fl}>Type</label>
    <select style={fi} value={type} onChange={e => setType(e.target.value)}>
      {Object.keys(LINK_STYLES).map(k => <option key={k} value={k}>{k}</option>)}
    </select>
    <label style={fl}>Label (optional)</label>
    <input style={fi} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Gi0/1 uplink" />
    <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
      <button style={fcBtn} onClick={onClose}>Cancel</button>
      <button style={{ ...fsBtn, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'default' }}
        onClick={() => canSave && onSave({ from_id: fromId, to_id: toId, link_type: type, label })}>
        Add link
      </button>
    </div>
  </>);
}

function rrect(ctx, x, y, w, h, r) {
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

const mapBtn = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 1px 4px rgba(0,0,0,.07)' };
const popBtn = { flex: 1, padding: '5px 8px', fontSize: 11, borderRadius: 5, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569' };
const fl = { fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4, marginTop: 12 };
const fi = { width: '100%', fontSize: 13, padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', background: '#fff', outline: 'none', boxSizing: 'border-box' };
const fcBtn = { padding: '8px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#475569' };
const fsBtn = { padding: '8px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer', border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 500 };
