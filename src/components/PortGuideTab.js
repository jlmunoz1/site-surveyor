import React, { useEffect, useState } from 'react';
import { supabase, isAdmin } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const SWITCH_POE = {
  'UCG-Fiber':        { rows: [{ ports:'1', speed:'2.5G', poe:'PoE++', watts:'60W', note:'5G Backup' }, { ports:'2–8', speed:'1G', poe:'PoE+', watts:'30W' }] },
  'Mission Critical': { rows: [{ ports:'1–8', speed:'1G', poe:'PoE+', watts:'30W', note:'RAK LoRa' }] },
  'USW-Pro-Max-16':   { rows: [{ ports:'1–12', speed:'1G', poe:'PoE+', watts:'30W' }, { ports:'13–16', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–2', speed:'10G', poe:'—', watts:'—' }] },
  'USW-Pro-Max-24':   { rows: [{ ports:'1–16', speed:'1G', poe:'PoE+/++', watts:'30–60W' }, { ports:'17–24', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–2', speed:'10G', poe:'—', watts:'—' }] },
  'USW-Pro-Max-48':   { rows: [{ ports:'1–32', speed:'1G', poe:'PoE+/++', watts:'30–60W' }, { ports:'33–48', speed:'2.5G', poe:'PoE++', watts:'60W' }, { ports:'SFP1–4', speed:'10G', poe:'—', watts:'—' }] },
};

const POE_STYLE = {
  'PoE++':    { bg: '#ede9fe', color: '#6d28d9' },
  'PoE+':     { bg: '#dbeafe', color: '#1e40af' },
  'PoE+/++':  { bg: '#e0e7ff', color: '#3730a3' },
  '—':        { bg: '#f1f5f9', color: '#475569' },
  'None':     { bg: '#f1f5f9', color: '#475569' },
};

export default function PortGuideTab() {
  const { profile } = useAuth();
  const admin = isAdmin(profile?.role);
  const [rules, setRules]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('rules');
  const [modal, setModal]     = useState(false);

  useEffect(() => {
    supabase.from('port_rules').select('*').then(({ data }) => { data = (data||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
      setRules(data || []);
      setLoading(false);
    });
  }, []);

  async function addRule(r) {
    const { data } = await supabase.from('port_rules').insert(r).select().single();
    if (data) setRules(rs => [...rs, data]);
    setModal(false);
  }
  async function deleteRule(id) {
    if (!window.confirm('Remove this rule?')) return;
    await supabase.from('port_rules').delete().eq('id', id);
    setRules(rs => rs.filter(r => r.id !== id));
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 96px)', background: '#f8fafc' }}>

      {/* Header + tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex' }}>
          {[['rules','Device Rules'],['poe','PoE Reference']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: '14px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${tab === id ? '#1d4ed8' : 'transparent'}`, color: tab === id ? '#1d4ed8' : '#64748b' }}>
              {label}
            </button>
          ))}
        </div>
        {admin && tab === 'rules' && (
          <button onClick={() => setModal(true)}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            + Add rule
          </button>
        )}
      </div>

      <div style={{ padding: '20px 28px', maxWidth: 900, margin: '0 auto' }}>

        {/* Device Rules */}
        {tab === 'rules' && (
          loading
            ? <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading…</div>
            : rules.length === 0
              ? <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>No rules yet</div>
              : (
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 160px 100px 80px 60px', gap: 0, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {['', 'Device', 'Switch', 'Port', 'PoE', ''].map((h, i) => (
                      <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
                    ))}
                  </div>
                  {/* Rows */}
                  {rules.map((r, idx) => {
                    const ps = POE_STYLE[r.poe_req] || POE_STYLE['None'];
                    return (
                      <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 160px 100px 80px 60px', gap: 0, padding: '12px 16px', borderBottom: idx < rules.length - 1 ? '1px solid #f1f5f9' : 'none', alignItems: 'center' }}>
                        {/* Icon */}
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: r.bg_color || '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className={`ti ${r.icon || 'ti-plug'}`} style={{ color: r.color || '#475569', fontSize: 14 }} />
                        </div>
                        {/* Device name + reason */}
                        <div style={{ paddingLeft: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{r.device_name}</div>
                          {r.reason && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{r.reason}</div>}
                        </div>
                        {/* Switch */}
                        <div style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{r.switch_target}</div>
                        {/* Port hint */}
                        <div style={{ fontSize: 11, color: '#64748b' }}>{r.port_hint}</div>
                        {/* PoE badge */}
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: ps.bg, color: ps.color }}>{r.poe_req}</span>
                        </div>
                        {/* Delete */}
                        {admin && (
                          <button onClick={() => deleteRule(r.id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, opacity: .5, padding: 0 }}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
        )}

        {/* PoE Reference */}
        {tab === 'poe' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {Object.entries(SWITCH_POE).map(([name, sw]) => (
              <div key={name} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 7, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ti ti-switch" style={{ color: '#1B3A6B', fontSize: 16 }} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{name}</div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Ports','Speed','PoE','Watts'].map(h => (
                        <th key={h} style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', padding: '7px 12px', textAlign: 'left', borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sw.rows.map((row, i) => {
                      const ps = POE_STYLE[row.poe] || POE_STYLE['None'];
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{row.ports}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: '#64748b' }}>{row.speed}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: ps.bg, color: ps.color }}>{row.poe}</span>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: '#475569' }}>
                            {row.watts}
                            {row.note && <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 600, marginLeft: 6 }}>{row.note}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && <AddRuleModal onSave={addRule} onClose={() => setModal(false)} cats={[...new Set(rules.map(r => r.category))]} />}
    </div>
  );
}

function AddRuleModal({ onSave, onClose, cats }) {
  const [f, setF] = useState({ device_name:'', icon:'ti-plug', color:'#475569', bg_color:'#f1f5f9', switch_target:'Mission Critical', port_hint:'', poe_req:'PoE+', reason:'', category:'' });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:12, padding:'22px 24px', width:400, maxWidth:'94vw', boxShadow:'0 20px 60px rgba(0,0,0,.2)', maxHeight:'90vh', overflowY:'auto' }}>
        <h3 style={{ fontSize:15, fontWeight:600, marginBottom:16, color:'#1e293b' }}>Add port rule</h3>
        {[['Device name','device_name','e.g. Digital Signage'],['Switch target','switch_target','e.g. Mission Critical'],['Port hint','port_hint','e.g. Any PoE+ port (1–8)'],['Reason','reason','Why this port?']].map(([label,key,ph]) => (
          <div key={key}>
            <label style={L}>{label}</label>
            <input style={I} value={f[key]} onChange={e => set(key, e.target.value)} placeholder={ph} />
          </div>
        ))}
        <label style={L}>PoE requirement</label>
        <select style={I} value={f.poe_req} onChange={e => set('poe_req', e.target.value)}>
          <option value="PoE+">PoE+ (30W)</option>
          <option value="PoE++">PoE++ (60W)</option>
          <option value="None">No PoE</option>
        </select>
        <label style={L}>Category</label>
        <input style={I} list="cats" value={f.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Security" />
        <datalist id="cats">{cats.map(c => <option key={c} value={c}/>)}</datalist>
        <div style={{ display:'flex', gap:8, marginTop:18, justifyContent:'flex-end' }}>
          <button style={{ padding:'8px 16px', fontSize:13, borderRadius:6, cursor:'pointer', border:'1px solid #e2e8f0', background:'#fff', color:'#475569' }} onClick={onClose}>Cancel</button>
          <button style={{ padding:'8px 16px', fontSize:13, borderRadius:6, cursor:'pointer', border:'none', background:'#1d4ed8', color:'#fff', fontWeight:500 }} onClick={() => f.device_name && onSave(f)}>Add rule</button>
        </div>
      </div>
    </div>
  );
}

const L = { fontSize:12, fontWeight:500, color:'#475569', display:'block', marginBottom:4, marginTop:12 };
const I = { width:'100%', fontSize:13, padding:'8px 11px', border:'1px solid #e2e8f0', borderRadius:6, color:'#1e293b', background:'#fff', outline:'none', boxSizing:'border-box' };
