import React, { useEffect, useState } from 'react';
import { supabase, DEVICE_OPTS, ICON_MAP, COLOR_MAP, canWrite } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function PortMapperTab() {
  const { profile } = useAuth();
  const write = canWrite(profile?.role);

  const [sites, setSites]     = useState([]);
  const [racks, setRacks]     = useState([]);
  const [devices, setDevices] = useState({}); // keyed by rackId
  const [ports, setPorts]     = useState({}); // keyed by deviceId
  const [selSite, setSelSite] = useState(null);
  const [selDev, setSelDev]   = useState(null); // {rackId, devId}
  const [modal, setModal]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [dragId, setDragId]       = useState(null);
  const [rackDragId, setRackDragId] = useState(null);

  // load projects
  useEffect(() => {
    supabase.from('sites').select('*').order('name').then(({ data }) => {
      setSites(data || []);
      if (data?.length) setSelSite(data[0].id);
    });
  }, []);

  // load all racks for selected project
  useEffect(() => {
    if (!selSite) return;
    setRacks([]);
    setDevices({});
    setPorts({});
    setSelDev(null);
    supabase.from('racks').select('*').eq('site_id', selSite).order('name').then(async ({ data, error }) => {
      if (error) { console.error('racks load error:', error); return; }
      const racksData = data || [];
      setRacks(racksData);
      // load devices for all racks
      if (racksData.length) {
        const rackIds = racksData.map(r => r.id);
        const { data: devData } = await supabase.from('devices').select('*').in('rack_id', rackIds);
        const devsByRack = {};
        (devData || []).sort((a,b) => (a.sort_order||0)-(b.sort_order||0)).forEach(d => {
          if (!devsByRack[d.rack_id]) devsByRack[d.rack_id] = [];
          devsByRack[d.rack_id].push(d);
        });
        setDevices(devsByRack);
      }
    });
  }, [selSite]);

  // load ports when a device is selected
  useEffect(() => {
    if (!selDev) return;
    supabase.from('ports').select('*').eq('device_id', selDev.devId).order('port_num').then(({ data }) => {
      setPorts(p => ({ ...p, [selDev.devId]: data || [] }));
    });
  }, [selDev?.devId]);

  const curSite  = sites.find(s => s.id === selSite);
  const curDevData = selDev ? (devices[selDev.rackId] || []).find(d => d.id === selDev.devId) : null;
  const curPorts   = selDev ? (ports[selDev.devId] || []) : [];
  const spec       = curDevData ? DEVICE_OPTS.find(o => o.key === curDevData.device_key) : null;

  // stats across all racks
  const allPorts   = Object.values(ports).flat();
  const usedP      = allPorts.filter(p => p.status === 'used').length;
  const reservedP  = allPorts.filter(p => p.status === 'reserved').length;
  const issueP     = allPorts.filter(p => p.status === 'issue').length;
  const totalPorts = allPorts.length;

  // ── Site/Project CRUD ─────────────────────────────────────
  async function addSite(name, location) {
    const { data, error } = await supabase.from('sites').insert({ name, location }).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    if (data) { setSites(s => [...s, data]); setSelSite(data.id); }
    setModal(null);
  }
  async function deleteSite(id) {
    if (!window.confirm('Delete this project and ALL its data?')) return;
    await supabase.from('sites').delete().eq('id', id);
    setSites(s => s.filter(x => x.id !== id));
    if (selSite === id) setSelSite(sites.find(s => s.id !== id)?.id || null);
  }

  // ── Rack CRUD ─────────────────────────────────────────────
  async function addRack(name, uSize = 6, rackType = 'vertical') {
    const { data, error } = await supabase.from('racks').insert({
      site_id: selSite, name, u_size: uSize, rack_type: rackType,
    }).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    if (data) {
      // store rack type in the name suffix for display
      const rackWithMeta = { ...data, rack_type: rackType, u_size: uSize };
      setRacks(r => [...r, rackWithMeta]);
      setDevices(d => ({ ...d, [data.id]: [] }));
      createMapNode(data).catch(console.error);
    }
    setModal(null);
  }

  async function createMapNode(rack) {
    // Use upsert on (site_id, label) so concurrent calls can never create duplicates
    const { data: existing } = await supabase
      .from('map_nodes').select('id,type,pos_x').eq('site_id', rack.site_id);
    const alreadyExists = (existing || []).find(n => n.label === rack.name);
    if (alreadyExists) return; // already on the map

    const count = (existing || []).length;
    // Arrange in a grid: 4 per row, 220px apart horizontally, 160px vertically
    const col = count % 4;
    const row = Math.floor(count / 4);
    const { data: node, error } = await supabase.from('map_nodes').insert({
      site_id: rack.site_id,
      label:     rack.name,
      type:      'idf',
      sub_label: rack.name,
      pos_x:     200 + col * 220,
      pos_y:     200 + row * 160,
    }).select().single();
    if (error) {
      // Ignore unique-violation (duplicate) — another call beat us to it
      if (error.code !== '23505') console.error('map node error:', error);
      return;
    }
    // Auto-link to MDF if one exists
    const mdf = (existing || []).find(n => n.type === 'mdf');
    if (mdf && node) {
      await supabase.from('map_links').insert({
        from_id: mdf.id, to_id: node.id, link_type: 'backbone', label: ''
      }).select();
    }
  }

  async function editRack(id, name, uSize, rackType) {
    const { error } = await supabase.from('racks').update({ name, u_size: uSize }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    // update the matching map node label too
    const rack = racks.find(r => r.id === id);
    if (rack) {
      await supabase.from('map_nodes')
        .update({ label: name, sub_label: name })
        .eq('site_id', rack.site_id)
        .eq('label', rack.name);
    }
    setRacks(r => r.map(x => x.id === id ? { ...x, name, u_size: uSize, rack_type: rackType } : x));
    setModal(null);
  }

  async function deleteRack(id) {
    if (!window.confirm('Delete this rack?')) return;
    // Remove matching map node if it exists and no other rack shares the same name
    const rack = racks.find(r => r.id === id);
    if (rack) {
      const otherRacksWithSameName = racks.filter(r => r.id !== id && r.name === rack.name && r.site_id === rack.site_id);
      if (otherRacksWithSameName.length === 0) {
        const { data: nodes } = await supabase.from('map_nodes').select('id')
          .eq('site_id', rack.site_id).eq('label', rack.name).limit(1);
        if (nodes?.[0]) {
          await supabase.from('map_links').delete().or(`from_id.eq.${nodes[0].id},to_id.eq.${nodes[0].id}`);
          await supabase.from('map_nodes').delete().eq('id', nodes[0].id);
        }
      }
    }
    await supabase.from('racks').delete().eq('id', id);
    setRacks(r => r.filter(x => x.id !== id));
    setDevices(d => { const n = { ...d }; delete n[id]; return n; });
    if (selDev?.rackId === id) setSelDev(null);
  }

  // ── Device CRUD ───────────────────────────────────────────
  async function addDevice(rackId, optLabel, label, uStart = null, mountMode = 'rack') {
    const opt = DEVICE_OPTS.find(o => o.label === optLabel);
    if (!opt) return;
    const rack = racks.find(r => r.id === rackId);
    const maxU = rack?.u_size || 6;
    const rackDevs = devices[rackId] || [];
    const usedU = rackDevs.reduce((a, d) => a + (d.u_size > 0 ? d.u_size : 0), 0);
    if (opt.u > 0 && !opt.wallMounted && !opt.floorMounted && usedU + opt.u > maxU) {
      alert(`Rack is full! This ${rack?.u_size || 6}U rack only has ${maxU - usedU}U remaining.`);
      return;
    }
    const maxOrder = rackDevs.reduce((a, d) => Math.max(a, d.sort_order || 0), 0);
    // u_size = 0 if wall or floor mounted, otherwise use device default
    const effectiveU = (mountMode === 'wall' || mountMode === 'floor') ? 0 : (opt.u ?? 1);
    const { data, error } = await supabase.from('devices').insert({
      rack_id: rackId, label: label || opt.label, device_key: opt.key,
      color: opt.color, u_size: effectiveU, ports: opt.ports, mount_mode: mountMode,
      ...(uStart ? { u_start: uStart } : {}),
      sfp_start: opt.sfpStart || null, sfp_count: opt.sfpCount || null,
      rj45_1g: opt.rj45_1g || null, rj45_25g: opt.rj45_25g || null,
      sort_order: maxOrder + 1,
    }).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    if (data) {
      setDevices(d => ({ ...d, [rackId]: [...(d[rackId] || []), data] }));
      if (opt.ports > 0) {
        const rows = Array.from({ length: opt.ports }, (_, i) => ({ device_id: data.id, port_num: i + 1, status: 'unused' }));
        await supabase.from('ports').insert(rows);
      }
    }
    setModal(null);
  }

  async function deleteDevice(rackId, id) {
    if (!window.confirm('Remove this device?')) return;
    await supabase.from('devices').delete().eq('id', id);
    setDevices(d => ({ ...d, [rackId]: (d[rackId] || []).filter(x => x.id !== id) }));
    if (selDev?.devId === id) setSelDev(null);
  }

  // ── Drag reorder ──────────────────────────────────────────
  async function editDevice(rackId, devId, newLabel, newDeviceKey, uStart = null, mountMode = 'rack') {
    // Find by label first (exact), then by key, then case-insensitive label
    const opt = DEVICE_OPTS.find(o => o.label === newDeviceKey)
             || DEVICE_OPTS.find(o => o.key   === newDeviceKey)
             || DEVICE_OPTS.find(o => o.label.toLowerCase() === (newDeviceKey||'').toLowerCase());
    if (!opt) { alert('Could not find device type: ' + newDeviceKey); return; }
    const uSize = (mountMode === 'wall' || mountMode === 'floor') ? 0 : (opt.u ?? 1);
    const updates = { label: newLabel?.trim() || opt.label, device_key: opt.key, color: opt.color, u_size: uSize, mount_mode: mountMode, ...(uStart !== null ? { u_start: uStart } : {}) };
    let error;
    try {
      ({ error } = await supabase.from('devices').update(updates).eq('id', devId));
    } catch(e) { setSaving(false); alert('Error updating device: ' + e.message); return; }
    if (error) { setSaving(false); alert('Error: ' + error.message); return; }
    // Regenerate ports if device type changed
    const existing = (devices[rackId] || []).find(d => d.id === devId);
    if (existing && existing.device_key !== opt.key) {
      await supabase.from('ports').delete().eq('device_id', devId);
      const newPorts = Array.from({ length: opt.ports || 0 }, (_, i) => ({
        device_id: devId, port_num: i + 1, status: 'unused', connected_device: '', jack_label: '', notes: ''
      }));
      if (newPorts.length) await supabase.from('ports').insert(newPorts);
      setPorts(p => { const n = { ...p }; delete n[devId]; return n; });
      if (selDev?.devId === devId) setSelDev(null);
    }
    setDevices(d => ({ ...d, [rackId]: (d[rackId] || []).map(x => x.id === devId ? { ...x, ...updates } : x) }));
    setSaving(false);
    setModal(null);
  }

  async function onDrop(rackId, targetId) {
    if (!dragId || dragId === targetId) return;
    const devs = [...(devices[rackId] || [])];
    const fi = devs.findIndex(d => d.id === dragId);
    const ti = devs.findIndex(d => d.id === targetId);
    if (fi < 0 || ti < 0) return;
    const [moved] = devs.splice(fi, 1);
    devs.splice(ti, 0, moved);
    const updated = devs.map((d, i) => ({ ...d, sort_order: i }));
    setDevices(d => ({ ...d, [rackId]: updated }));
    setDragId(null);
    await Promise.all(updated.map(d => supabase.from('devices').update({ sort_order: d.sort_order }).eq('id', d.id)));
  }

  // ── Port update ───────────────────────────────────────────
  async function savePort(portId, updates) {
    setSaving(true);
    await supabase.from('ports').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', portId);
    if (selDev) setPorts(p => ({ ...p, [selDev.devId]: (p[selDev.devId] || []).map(x => x.id === portId ? { ...x, ...updates } : x) }));
    setSaving(false);
    setModal(null);
  }

  // ── Rack drag-to-reorder ─────────────────────────────────
  async function onRackDrop(targetId) {
    if (!rackDragId || rackDragId === targetId) return;
    const arr = [...racks];
    const fi  = arr.findIndex(r => r.id === rackDragId);
    const ti  = arr.findIndex(r => r.id === targetId);
    const [moved] = arr.splice(fi, 1);
    arr.splice(ti, 0, moved);
    const updated = arr.map((r, i) => ({ ...r, sort_order: i }));
    setRacks(updated);
    // Try saving sort order — silently ignore if column doesn't exist yet
    try {
      await Promise.all(updated.map(r =>
        supabase.from('racks').update({ sort_order: r.sort_order }).eq('id', r.id)
      ));
    } catch (e) { console.warn('sort_order not saved (column may not exist yet):', e); }
    setRackDragId(null);
  }

  const totalU = (rackId) => (devices[rackId] || []).reduce((a, d) => {
    if (d.u_size === 0 || d.mount_mode === 'wall' || d.mount_mode === 'floor') return a;
    return a + (d.u_size || 1);
  }, 0);

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 96px)' }}>

      {/* Sidebar — Projects */}
      <div style={S.sidebar}>
        <div style={S.sideHead}>
          <span style={S.sideLabel}>Projects</span>
          {write && <button style={S.iconBtn} onClick={() => setModal({ type: 'addSite' })}>+</button>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {sites.map(s => (
            <div key={s.id} style={{ ...S.siteItem, ...(selSite === s.id ? S.siteActive : {}) }} onClick={() => setSelSite(s.id)}>
              <div style={{ ...S.siteDot, ...(selSite === s.id ? { background: '#3b82f6' } : {}) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{s.location}</div>
              </div>
              {write && selSite === s.id && (
                <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}
                  onClick={e => { e.stopPropagation(); deleteSite(s.id); }}>×</button>
              )}
            </div>
          ))}
        </div>
        {write && <button style={S.addSiteBtn} onClick={() => setModal({ type: 'addSite' })}>+ Add project</button>}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {!curSite ? (
          <div style={S.emptyState}>Select or add a project</div>
        ) : (<>
          {/* Project header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{curSite.name}</h2>
              {curSite.location && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{curSite.location}</div>}
            </div>
            {write && <button style={S.btn} onClick={() => setModal({ type: 'addRack' })}>+ Add rack</button>}
          </div>

          {/* Stats across all racks */}
          <div style={S.statsBar}>
            {[['Total ports', totalPorts, '#1e293b'], ['Active', usedP, '#16a34a'], ['Reserved', reservedP, '#d97706'], ['Issues', issueP, '#dc2626']].map(([l, v, c]) => (
              <div key={l} style={S.statCard}>
                <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          {racks.length === 0 ? (
            <div style={S.emptyState}>No racks yet — add one above</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
              {racks.map(rack => {
                const rackDevs = devices[rack.id] || [];
                const rackPorts = rackDevs.flatMap(d => ports[d.id] || []);
                const rackUsed = rackPorts.filter(p => p.status === 'used').length;
                const rackIssues = rackPorts.filter(p => p.status === 'issue').length;
                return (
                  <div key={rack.id}
                    draggable={!!write}
                    onDragStart={() => setRackDragId(rack.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onRackDrop(rack.id)}
                    onDragEnd={() => setRackDragId(null)}
                    style={{ ...S.rackCard, opacity: rackDragId === rack.id ? 0.45 : 1, cursor: write ? 'grab' : 'default', transition: 'opacity 0.15s' }}>
                    {/* Rack card header */}
                    <div style={S.rackCardHead}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {rack.name}
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>
                            {rack.u_size || 6}U
                          </span>
                          {rack.rack_type && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: rack.rack_type === 'wall-mount' ? '#dbeafe' : rack.rack_type === 'community' ? '#fef9c3' : '#dcfce7', color: rack.rack_type === 'wall-mount' ? '#1e40af' : rack.rack_type === 'community' ? '#854d0e' : '#166534' }}>
                              {rack.rack_type === 'wall-mount' ? 'Wall-Mount' : rack.rack_type === 'community' ? 'Community' : 'Vertical'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {totalU(rack.id)}/{rack.u_size || 6}U · {rackPorts.length} ports · {rackUsed} active
                          {rackIssues > 0 && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ {rackIssues} issues</span>}
                        </div>
                      </div>
                      {write && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, color: '#475569', cursor: 'pointer', fontSize: 12, padding: '3px 8px' }}
                            onClick={() => setModal({ type: 'editRack', rack })}>✏ Edit</button>
                          <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, opacity: .6 }}
                            onClick={() => deleteRack(rack.id)}>🗑</button>
                        </div>
                      )}
                    </div>

                    {/* Rack enclosure */}
                    <div style={{ padding: '0 12px 12px' }}>
                      <div style={{ ...S.rackShell, position: 'relative' }}>
                        <div style={{ position: 'absolute', top: -9, right: 10, fontSize: 9, fontWeight: 600, background: '#16213e', color: '#4a6fa5', padding: '0 5px' }}>{rack.u_size || 6}U</div>
                        <div style={S.rackEars}><div style={S.ear}/><div style={S.ear}/></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {rackDevs.filter(d => { return d.u_size > 0 && d.mount_mode !== 'wall' && d.mount_mode !== 'floor'; }).length === 0 && (
                            <div style={{ height: 32, borderRadius: 5, border: '1px dashed #2a3a55', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ fontSize: 10, color: '#4a6fa5' }}>empty rack</span>
                            </div>
                          )}
                          {rackDevs.filter(d => { return d.u_size > 0 && d.mount_mode !== 'wall' && d.mount_mode !== 'floor'; }).map(dev => {
                            const h = 32 * (dev.u_size || 1) + ((dev.u_size || 1) - 1) * 3;
                            const isEmpty = dev.device_key === 'empty';
                            const cm = COLOR_MAP[dev.color] || COLOR_MAP.gray;
                            const icon = ICON_MAP[dev.device_key] || 'ti-box';
                            const isSelected = selDev?.devId === dev.id;
                            return (
                              <div key={dev.id}
                                draggable={write && !isEmpty}
                                onDragStart={() => setDragId(dev.id)}
                                onDragOver={e => e.preventDefault()}
                                onDrop={() => onDrop(rack.id, dev.id)}
                                onDragEnd={() => setDragId(null)}
                                onClick={() => !isEmpty && setSelDev({ rackId: rack.id, devId: dev.id })}
                                style={{
                                  height: h, borderRadius: 5,
                                  border: `1.5px solid ${isSelected ? '#3b82f6' : '#2a3a55'}`,
                                  background: isEmpty ? '#111827' : cm.rack,
                                  display: 'flex', alignItems: 'center', padding: '0 6px', gap: 5,
                                  cursor: isEmpty ? 'default' : 'pointer', userSelect: 'none',
                                  opacity: dragId === dev.id ? 0.4 : 1,
                                  boxShadow: isSelected ? '0 0 0 2px #1d4ed830' : 'none',
                                  position: 'relative',
                                }}>
                                {!isEmpty ? <>
                                  <i className="ti ti-grip-vertical" style={{ color: cm.slot, opacity: .4, fontSize: 12, flexShrink: 0 }} />
                                  <i className={`ti ${icon}`} style={{ fontSize: 11, color: cm.slot, flexShrink: 0 }} />
                                  <span style={{ fontSize: 10, fontWeight: 500, flex: 1, color: cm.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.label}</span>
                                  {dev.u_start && rack.rack_type === 'community' && (
                                    <span style={{ fontSize: 8, fontWeight: 700, color: '#854d0e', background: '#fef9c3', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>U{dev.u_start}</span>
                                  )}
                                  {dev.ports > 0 && <span style={{ fontSize: 9, color: '#4a6fa5', flexShrink: 0 }}>{dev.ports}p</span>}
                                  {write && (
                                    <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 2 }} onClick={e => e.stopPropagation()}>
                                      <button onClick={e => { e.stopPropagation(); setSaving(false); setModal({ type: 'editDevice', rackId: rack.id, dev }); }}
                                        style={{ background: 'rgba(255,255,255,0.13)', border: 'none', borderRadius: 3, color: '#93c5fd', cursor: 'pointer', fontSize: 9, padding: '1px 4px' }}
                                        title="Edit device">✏</button>
                                      <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete ' + dev.label + '? This removes all its ports.')) deleteDevice(rack.id, dev.id); }}
                                        style={{ background: 'rgba(255,255,255,0.13)', border: 'none', borderRadius: 3, color: '#fca5a5', cursor: 'pointer', fontSize: 9, padding: '1px 4px' }}
                                        title="Delete device">✕</button>
                                    </div>
                                  )}
                                </> : <span style={{ fontSize: 10, color: '#2a3a55' }}>—</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ ...S.rackEars, marginTop: 6, marginBottom: 0 }}><div style={S.ear}/><div style={S.ear}/></div>
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: '#4a6fa5', margin: '4px 0 2px' }}>{totalU(rack.id)} / {rack.u_size || 6}U used</div>
                      {write && (
                        <button style={S.addSlotBtn} onClick={() => setModal({ type: 'addDevice', rackId: rack.id, rackType: rack.rack_type })}>+ add device</button>
                      )}
                      {/* Wall-mounted devices — shown below rack, don't consume U space */}
                      {rackDevs.filter(d => { return d.u_size === 0 || d.mount_mode === 'wall' || d.mount_mode === 'floor'; }).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: '#4a6fa5', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4, paddingLeft: 2 }}>
                            📌 Wall / Floor mounted
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {rackDevs.filter(d => { return d.u_size === 0 || d.mount_mode === 'wall' || d.mount_mode === 'floor'; }).map(dev => {
                              const isEmpty = dev.device_key === 'empty';
                              const cm = COLOR_MAP[dev.color] || COLOR_MAP.teal || COLOR_MAP.gray;
                              const icon = ICON_MAP[dev.device_key] || 'ti-box';
                              const isSelected = selDev?.devId === dev.id;
                              return (
                                <div key={dev.id}
                                  onClick={() => !isEmpty && setSelDev({ rackId: rack.id, devId: dev.id })}
                                  style={{
                                    height: 28, borderRadius: 5,
                                    border: `1.5px solid ${isSelected ? '#3b82f6' : '#1e4976'}`,
                                    background: isSelected ? '#0f2a4a' : '#0d1f35',
                                    display: 'flex', alignItems: 'center', padding: '0 6px', gap: 5,
                                    cursor: 'pointer', userSelect: 'none',
                                  }}>
                                  <i className={`ti ${icon}`} style={{ fontSize: 11, color: cm.slot || '#5eead4', flexShrink: 0 }} />
                                  <span style={{ fontSize: 10, fontWeight: 500, flex: 1, color: cm.label || '#99f6e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.label}</span>
                                  <span style={{ fontSize: 8, color: dev.mount_mode === 'floor' ? '#fbbf24' : '#2dd4bf', background: dev.mount_mode === 'floor' ? '#451a03' : '#0f3d38', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
                                    {dev.mount_mode === 'floor' ? 'floor' : 'wall'}
                                  </span>
                                  {dev.u_start && rack.rack_type === 'community' && (
                                    <span style={{ fontSize: 8, fontWeight: 700, color: '#854d0e', background: '#fef9c3', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>U{dev.u_start}</span>
                                  )}
                                  {dev.ports > 0 && <span style={{ fontSize: 9, color: '#4a6fa5', flexShrink: 0 }}>{dev.ports}p</span>}
                                  {write && (
                                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                      <button onClick={e => { e.stopPropagation(); setSaving(false); setModal({ type: 'editDevice', rackId: rack.id, dev }); }}
                                        style={{ background: 'rgba(255,255,255,0.13)', border: 'none', borderRadius: 3, color: '#93c5fd', cursor: 'pointer', fontSize: 9, padding: '1px 4px' }}>✏</button>
                                      <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete ' + dev.label + '?')) deleteDevice(rack.id, dev.id); }}
                                        style={{ background: 'rgba(255,255,255,0.13)', border: 'none', borderRadius: 3, color: '#fca5a5', cursor: 'pointer', fontSize: 9, padding: '1px 4px' }}>✕</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Port detail panel — shown when a device is selected */}
          {selDev && curDevData && (
            <div style={{ marginTop: 24, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: (COLOR_MAP[curDevData.color] || COLOR_MAP.gray).bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`ti ${ICON_MAP[curDevData.device_key] || 'ti-box'}`} style={{ fontSize: 18, color: (COLOR_MAP[curDevData.color] || COLOR_MAP.gray).text }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{curDevData.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{curDevData.device_key} · {curDevData.u_size}U{curDevData.ports ? ` · ${curDevData.ports} ports` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {spec?.sfpStart && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9', fontWeight: 500 }}>{spec.sfpCount}× SFP+</span>}
                  {write && <button style={S.chipRed} onClick={() => deleteDevice(selDev.rackId, selDev.devId)}>🗑 remove</button>}
                  <button style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }} onClick={() => setSelDev(null)}>×</button>
                </div>
              </div>

              {curDevData.ports > 0 && (() => {
                const sfpStart = curDevData.sfp_start;
                const rj45 = sfpStart ? curPorts.filter(p => p.port_num < sfpStart) : curPorts;
                const sfps = sfpStart ? curPorts.filter(p => p.port_num >= sfpStart) : [];
                const legend = (
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
                    {[['#22c55e','Active'],['#cbd5e1','Unused'],['#f59e0b','Reserved'],['#ef4444','Issue']].map(([c,l]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
                        <div style={{ width: 3, height: 14, borderRadius: 2, background: c }} />{l}
                      </div>
                    ))}
                  </div>
                );
                return (<>
                  {sfpStart && <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 6 }}>RJ45 <span style={{ color: '#94a3b8', fontWeight: 400 }}>{curDevData.rj45_1g}× 1G · {curDevData.rj45_25g}× 2.5G</span></div>}
                  {legend}
                  <div style={S.portGrid}>
                    {rj45.map(p => <PortCard key={p.id} p={p} spec={curDevData} write={write} onClick={() => write && setModal({ type: 'editPort', data: p })} />)}
                  </div>
                  {sfps.length > 0 && <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6d28d9', margin: '14px 0 6px', paddingTop: 10, borderTop: '1px solid #ede9fe' }}>
                      SFP+ Uplink Ports <span style={{ color: '#a78bfa', fontWeight: 400 }}>{curDevData.sfp_count}× 10G</span>
                    </div>
                    <div style={S.portGrid}>
                      {sfps.map((p, i) => <PortCard key={p.id} p={p} spec={curDevData} sfpIndex={i} write={write} onClick={() => write && setModal({ type: 'editPort', data: p })} />)}
                    </div>
                  </>}
                </>);
              })()}
            </div>
          )}
        </>)}
      </div>

      {modal && (
        <Modal modal={modal} onClose={() => setModal(null)}
          onAddSite={addSite} onAddRack={addRack} onEditRack={editRack} onAddDevice={addDevice}
          onEditDevice={editDevice} onSavePort={savePort} saving={saving} />
      )}
    </div>
  );
}

function PortCard({ p, spec, sfpIndex, write, onClick }) {
  const isSFP   = sfpIndex !== undefined;
  const is25g   = spec?.rj45_1g && !isSFP && p.port_num > spec.rj45_1g;
  const borderColor = { used: '#22c55e', unused: isSFP ? '#a78bfa' : '#e2e8f0', reserved: '#f59e0b', issue: '#ef4444' }[p.status];
  const statusColor = { used: '#16a34a', unused: '#94a3b8', reserved: '#d97706', issue: '#dc2626' }[p.status];
  // PoE badge
  let poeBadge = null;
  if (isSFP)       poeBadge = { label: 'SFP+',  bg: '#f3f4f6', color: '#6b7280' };
  else if (is25g)  poeBadge = { label: 'PoE++', bg: '#ede9fe', color: '#7c3aed' };
  else if (spec)   poeBadge = { label: 'PoE+',  bg: '#dbeafe', color: '#1d4ed8' };
  return (
    <div onClick={onClick} style={{ background: p.status === 'issue' ? '#fff5f5' : '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `3px solid ${borderColor}`, borderRadius: 6, padding: '8px 10px', cursor: write ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{isSFP ? `SFP${sfpIndex + 1}` : `Port ${p.port_num}`}</span>
        {poeBadge && <span style={{ background: poeBadge.bg, color: poeBadge.color, fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 10 }}>{poeBadge.label}</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#1e293b', minHeight: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.connected_device || '\u00a0'}</div>
      <div style={{ fontSize: 11, color: '#64748b', minHeight: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.jack_label || '\u00a0'}</div>
      <div style={{ fontSize: 10, marginTop: 3, fontWeight: 600, color: statusColor }}>{p.status}</div>
    </div>
  );
}

function Modal({ modal, onClose, onAddSite, onAddRack, onEditRack, onAddDevice, onEditDevice, onSavePort, saving }) {
  const [f1, setF1] = useState(modal.dev?.label || modal.data?.connected_device || modal.data?.label || modal.rack?.name || '');
  const [f2, setF2] = useState(modal.data?.jack_label || modal.data?.location || '');
  const [f3, setF3] = useState(modal.data?.status || 'unused');
  const [f4, setF4] = useState(modal.data?.notes || '');
  const [sel, setSel] = useState(modal.dev ? (DEVICE_OPTS.find(o => o.key === modal.dev?.device_key)?.label || DEVICE_OPTS[0]?.label) : DEVICE_OPTS[0]?.label || '');
  const [rackSize, setRackSize] = useState(String(modal.rack?.u_size || '6'));
  const [uStart, setUStart]     = useState(String(modal.dev?.u_start || ''));
  const selOpt = DEVICE_OPTS.find(o => o.label === sel);
  const mountOpts = selOpt?.mountOptions || [];
  const defaultMount = modal.dev?.mount_mode || (mountOpts[0] || 'rack');
  const [mountMode, setMountMode] = useState(defaultMount);
  const [rackType, setRackType] = useState(modal.rack?.rack_type || 'vertical');

  const submit = () => {
    if (modal.type === 'addSite'   && typeof onAddSite   === 'function') onAddSite(f1, f2);
    if (modal.type === 'addRack'   && typeof onAddRack   === 'function') onAddRack(f1, parseInt(rackSize), rackType);
    if (modal.type === 'editRack'  && typeof onEditRack  === 'function') onEditRack(modal.rack.id, f1, parseInt(rackSize), rackType);
    if (modal.type === 'addDevice' && typeof onAddDevice === 'function') onAddDevice(modal.rackId, sel, f1, uStart ? parseInt(uStart) : null, mountMode || 'rack');
    if (modal.type === 'editDevice' && typeof onEditDevice === 'function') onEditDevice(modal.rackId, modal.dev.id, f1, sel, uStart ? parseInt(uStart) : null, mountMode || 'rack');
    if (modal.type === 'editDevice' && typeof onEditDevice !== 'function') console.error('onEditDevice is not a function', onEditDevice);
    if (modal.type === 'editPort'  && typeof onSavePort  === 'function') onSavePort(modal.data.id, { connected_device: f1, jack_label: f2, status: f3, notes: f4 });
  };

  const titles = { addSite: '🏢 Add project', addRack: '🗄 Add rack', editRack: '✏️ Edit rack', addDevice: '➕ Add device', editDevice: '✏️ Edit device', editPort: `🔌 Port ${modal.data?.port_num}` };
  const rackTypeIcon = { 'wall-mount': '🟦', 'vertical': '⬜', 'community': '🔲' };

  return (
    <div style={M.bg} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={M.box}>
        <h3 style={M.title}>{titles[modal.type]}</h3>
        {modal.type === 'addSite' && <>
          <label style={M.label}>Project name</label>
          <input style={M.input} value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. Claiborne Gulfport" autoFocus />
          <label style={M.label}>Location</label>
          <input style={M.input} value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. Gulfport, MS" />
        </>}
        {(modal.type === 'addRack' || modal.type === 'editRack') && <>
          <label style={M.label}>Rack name</label>
          <input style={M.input} value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. IDF 1 – Hallway A" autoFocus />
          <label style={M.label}>Rack size</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 4 }}>
            {[['2','2U Rack'],['6','6U Rack'],['12','12U Rack'],['42','42U Rack']].map(([val, label]) => (
              <div key={val} onClick={() => setRackSize(val)}
                style={{ border: `2px solid ${rackSize === val ? '#1d4ed8' : '#e2e8f0'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', background: rackSize === val ? '#eff6ff' : '#fff', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>🗄</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: rackSize === val ? '#1d4ed8' : '#1e293b' }}>{label}</div>
              </div>
            ))}
          </div>
          <label style={M.label}>Rack type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['wall-mount','Wall-Mount'],['vertical','Vertical'],['community','Community Rack (2-post)']].map(([val, label]) => (
              <div key={val} onClick={() => setRackType(val)}
                style={{ border: `2px solid ${rackType === val ? '#1d4ed8' : '#e2e8f0'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', background: rackType === val ? '#eff6ff' : '#fff', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{rackTypeIcon[val]}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: rackType === val ? '#1d4ed8' : '#1e293b' }}>{label}</div>
              </div>
            ))}
          </div>
        </>}
        {(modal.type === 'addDevice' || modal.type === 'editDevice') && <>
          <label style={M.label}>Device type</label>
          <select style={M.input} value={sel} onChange={e => setSel(e.target.value)}>
            {DEVICE_OPTS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
          </select>
          <label style={M.label}>Label</label>
          <input style={M.input} value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. SW-01 Mission Critical" autoFocus />
          {mountOpts.length > 0 && <>
            <label style={M.label}>Mount location</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['rack','wall','floor'].filter(m => mountOpts.includes(m)).map(m => (
                <button key={m} type="button"
                  onClick={() => setMountMode(m)}
                  style={{ flex: 1, padding: '7px 4px', border: `2px solid ${mountMode === m ? '#1B3A6B' : '#e2e8f0'}`, borderRadius: 6, background: mountMode === m ? '#eff6ff' : '#fff', color: mountMode === m ? '#1B3A6B' : '#64748b', fontWeight: mountMode === m ? 700 : 400, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {m === 'rack' ? '🗄 In Rack' : m === 'wall' ? '🔲 Wall' : '🏗 Floor'}
                </button>
              ))}
            </div>
          </>}
          {(modal.rackType === 'community' || mountMode === 'rack') && <>
            <label style={M.label}>U Position (starting rack unit, optional)</label>
            <input style={M.input} type="number" min="1" max="42" value={uStart}
              onChange={e => setUStart(e.target.value)} placeholder="e.g. 12 (community rack)" />
          </>}
        </>}
        {modal.type === 'addDevice_DISABLED' && <>
          <label style={M.label}>Device type</label>
          <select style={M.input} value={sel} onChange={e => setSel(e.target.value)}>
            {DEVICE_OPTS.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
          </select>
          <label style={M.label}>Label</label>
          <input style={M.input} value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. SW-01 Mission Critical" />
        </>}
        {modal.type === 'editPort' && <>
          <label style={M.label}>Connected device</label>
          <input style={M.input} value={f1} onChange={e => setF1(e.target.value)} placeholder="e.g. Nurse Station PC" autoFocus />
          <label style={M.label}>Port / jack label</label>
          <input style={M.input} value={f2} onChange={e => setF2(e.target.value)} placeholder="e.g. Gi0/1 or Wall-A1" />
          <label style={M.label}>Status</label>
          <select style={M.input} value={f3} onChange={e => setF3(e.target.value)}>
            {['unused','used','reserved','issue'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label style={M.label}>Notes</label>
          <input style={M.input} value={f4} onChange={e => setF4(e.target.value)} placeholder="Cable color, run length…" />
        </>}
        <div style={M.btns}>
          <button style={M.cancel} onClick={onClose}>Cancel</button>
          <button style={M.save} onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  sidebar:      { width: 240, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  sideHead:     { padding: '16px 16px 8px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sideLabel:    { fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '.08em', textTransform: 'uppercase' },
  iconBtn:      { background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  siteItem:     { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#475569', border: '1px solid transparent', marginBottom: 2 },
  siteActive:   { background: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8', fontWeight: 500 },
  siteDot:      { width: 7, height: 7, borderRadius: '50%', background: '#e2e8f0', flexShrink: 0 },
  addSiteBtn:   { margin: '4px 8px 12px', width: 'calc(100% - 16px)', background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: 6, padding: 8, fontSize: 12, color: '#94a3b8', cursor: 'pointer' },
  btn:          { padding: '7px 16px', fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#475569' },
  statsBar:     { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 },
  statCard:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', textAlign: 'center' },
  rackCard:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
  rackCardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #f1f5f9' },
  rackShell:    { background: '#16213e', borderRadius: 8, padding: '10px 10px' },
  rackEars:     { display: 'flex', gap: 5, marginBottom: 6 },
  ear:          { height: 8, flex: 1, background: '#1e2d48', borderRadius: 3, border: '1px solid #2a3f5f' },
  addSlotBtn:   { width: '100%', background: 'transparent', border: '1px dashed #2a3f5f', borderRadius: 5, padding: 6, fontSize: 10, color: '#4a6fa5', cursor: 'pointer' },
  emptyState:   { textAlign: 'center', padding: '60px 20px', color: '#94a3b8', fontSize: 14, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' },
  portGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 6 },
  chipRed:      { fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 500, background: '#fee2e2', color: '#991b1b', border: 'none', cursor: 'pointer' },
};
const M = {
  bg:     { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  box:    { background: '#fff', borderRadius: 12, padding: '22px 24px', width: 380, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,.2)' },
  title:  { fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 16 },
  label:  { fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4, marginTop: 12 },
  input:  { width: '100%', fontSize: 13, padding: '8px 11px', border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', background: '#fff', outline: 'none', boxSizing: 'border-box' },
  btns:   { display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' },
  cancel: { padding: '8px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#475569' },
  save:   { padding: '8px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer', border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 500 },
};
