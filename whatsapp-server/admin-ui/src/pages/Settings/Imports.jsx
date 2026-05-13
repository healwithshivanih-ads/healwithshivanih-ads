import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Button from '../../components/Button.jsx';
import Input from '../../components/Input.jsx';
import { Table } from '../../components/Table.jsx';

const TARGET_FIELDS = [
  { v: '', label: '— skip —' },
  { v: 'primary_phone', label: 'Phone' },
  { v: 'primary_email', label: 'Email' },
  { v: 'display_name', label: 'Display name' },
  { v: '_first_name', label: 'First name' },
  { v: '_last_name', label: 'Last name' },
  { v: 'city', label: 'City' },
  { v: 'country', label: 'Country' },
  { v: 'locale', label: 'Locale' },
  { v: 'tags', label: 'Tags (semicolon-separated)' },
  { v: 'wix_id', label: 'Wix ID' },
  { v: 'opt_in_source', label: 'Opt-in source' },
];

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function Imports() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState('idle'); // idle | preview | uploading | done
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [tags, setTags] = useState('');
  const [optInSource, setOptInSource] = useState('csv_import');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const fileInput = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api.imports({ limit: 50 });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function onFile(f) {
    if (!f) return;
    setFile(f); setErr(''); setResult(null); setStage('preview');
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) { setErr('Empty file'); return; }
    const cols = csvSplit(lines[0]);
    setHeaders(cols);
    setPreviewRows(lines.slice(1, 6).map((l) => csvSplit(l)));
    const auto = {};
    for (const c of cols) {
      const k = c.toLowerCase().trim();
      if (k.includes('phone') || k === 'mobile') auto[c] = 'primary_phone';
      else if (k.includes('email')) auto[c] = 'primary_email';
      else if (k === 'name' || k === 'full_name' || k === 'display_name') auto[c] = 'display_name';
      else if (k === 'first_name') auto[c] = '_first_name';
      else if (k === 'last_name') auto[c] = '_last_name';
      else if (k === 'city') auto[c] = 'city';
      else if (k === 'country') auto[c] = 'country';
      else if (k === 'locale' || k === 'language') auto[c] = 'locale';
      else if (k === 'tags' || k === 'labels') auto[c] = 'tags';
      else if (k === 'wix_id' || k === 'wix_contact_id') auto[c] = 'wix_id';
      else auto[c] = '';
    }
    setMapping(auto);
  }

  async function upload() {
    if (!file) return;
    setStage('uploading'); setErr('');
    try {
      const cleanMap = {};
      for (const [k, v] of Object.entries(mapping)) if (v) cleanMap[k] = v;
      const config = {
        column_mapping: cleanMap,
        default_tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        default_opt_in_source: optInSource || 'csv_import',
      };
      const res = await api.uploadImport(file, config);
      setResult(res);
      setStage('done');
      load();
    } catch (e) { setErr(e.message); setStage('preview'); }
  }

  function reset() {
    setFile(null); setHeaders([]); setPreviewRows([]); setMapping({});
    setStage('idle'); setResult(null); setErr('');
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold">CSV Imports</h1>
        <p className="text-xs text-slate-500">Upload a CSV of contacts. Existing contacts get matched + patched, new ones are created.</p>
      </header>

      <section className="card p-4">
        {stage === 'idle' && (
          <div className="text-sm">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm"
            />
            <p className="mt-2 text-xs text-slate-500">First row should be headers. Files &lt; 1MB process synchronously; larger files queue.</p>
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{file?.name} <span className="text-xs text-slate-500">({Math.round((file?.size || 0) / 1024)} KB)</span></span>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-medium text-slate-700">Preview (first 5 rows)</h3>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>{headers.map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-medium text-slate-700">Map columns</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {headers.map((h) => (
                  <label key={h} className="block">
                    <span className="mb-0.5 block text-xs text-slate-500">{h}</span>
                    <select className="input" value={mapping[h] || ''}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                      {TARGET_FIELDS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="Default tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. csv-import-may, lions-gate" />
              <Input label="Default opt-in source" value={optInSource} onChange={(e) => setOptInSource(e.target.value)} />
            </div>

            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={reset}>Reset</Button>
              <Button onClick={upload}>Import</Button>
            </div>
          </div>
        )}

        {stage === 'uploading' && (
          <p className="text-sm text-slate-600">Uploading + processing… (won't navigate away)</p>
        )}

        {stage === 'done' && result && (
          <div className="space-y-2 text-sm">
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
              <strong>Done.</strong> Status: {result.status}
            </div>
            <ul className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <li className="rounded bg-slate-50 p-2"><strong className="text-base text-slate-900">{result.matched_existing || 0}</strong><br />Matched existing</li>
              <li className="rounded bg-slate-50 p-2"><strong className="text-base text-slate-900">{result.created_new || 0}</strong><br />Created new</li>
              <li className="rounded bg-slate-50 p-2"><strong className="text-base text-slate-900">{result.skipped || 0}</strong><br />Skipped</li>
              <li className="rounded bg-slate-50 p-2"><strong className="text-base text-red-700">{result.failed || 0}</strong><br />Failed</li>
            </ul>
            {result.errors && result.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-700">Show {result.errors.length} error sample(s)</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-100 p-2">{JSON.stringify(result.errors, null, 2)}</pre>
              </details>
            )}
            <div className="pt-1"><Button variant="ghost" onClick={reset}>Import another</Button></div>
          </div>
        )}
      </section>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent imports</h2>
      <Table
        columns={[
          { key: 'uploaded_at', header: 'When', render: (r) => fmtTs(r.uploaded_at) },
          { key: 'filename', header: 'File', render: (r) => r.filename || '—' },
          { key: 'status', header: 'Status' },
          { key: 'total_rows', header: 'Rows' },
          { key: 'created_new', header: 'Created' },
          { key: 'matched_existing', header: 'Matched' },
          { key: 'skipped', header: 'Skipped' },
          { key: 'failed', header: 'Failed' },
        ]}
        rows={loading ? [] : items}
        empty={loading ? 'Loading…' : 'No imports yet.'}
      />
    </div>
  );
}

// Simple CSV-line splitter for the preview only. The server uses csv-parse for real.
function csvSplit(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
