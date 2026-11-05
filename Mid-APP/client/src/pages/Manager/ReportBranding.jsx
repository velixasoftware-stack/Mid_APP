import { useEffect, useState } from 'react';
import api from '../../api/client';
import { analyzeLetterhead, DEFAULT_LETTERHEAD_TOP_MM, DEFAULT_LETTERHEAD_BOTTOM_MM } from '../../utils/letterhead';

export default function ReportBranding() {
  const [branding, setBranding] = useState({ logoUrl: null, letterheadUrl: null });
  const [logoFile, setLogoFile] = useState(null);
  const [letterheadFile, setLetterheadFile] = useState(null);
  const [detailsForm, setDetailsForm] = useState({ clientName: '', address: '', mobile: '', email: '', letterheadTopMm: '', letterheadBottomMm: '' });
  const [letterheadInfo, setLetterheadInfo] = useState(null); // { isPage, topMm, bottomMm } detected from the image
  const letterheadIsPage = !!letterheadInfo?.isPage;
  // What the report uses when a box is left blank: detected from the letterhead itself.
  const autoTopMm = letterheadInfo?.topMm ?? DEFAULT_LETTERHEAD_TOP_MM;
  const autoBottomMm = letterheadInfo?.bottomMm ?? DEFAULT_LETTERHEAD_BOTTOM_MM;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [doctors, setDoctors] = useState([]);
  const [doctorDrafts, setDoctorDrafts] = useState({}); // userId -> { signatureName, designation } in-progress before Save
  const [savingDoctorId, setSavingDoctorId] = useState(null);
  const [doctorError, setDoctorError] = useState('');

  async function load() {
    const { data } = await api.get('/branding');
    setBranding(data);
    setDetailsForm({
      clientName: data.clientName || '', address: data.address || '', mobile: data.mobile || '', email: data.email || '',
      letterheadTopMm: data.letterheadTopMm ?? '', letterheadBottomMm: data.letterheadBottomMm ?? '',
    });
  }
  async function loadDoctors() {
    const { data } = await api.get('/branding/doctors');
    setDoctors(data);
    setDoctorDrafts(Object.fromEntries(data.map((u) => [
      u.id, { signatureName: u.signatureName || '', designation: u.designation || '' },
    ])));
  }
  useEffect(() => { load(); loadDoctors(); }, []);
  useEffect(() => {
    let alive = true;
    analyzeLetterhead(branding.letterheadUrl).then((r) => { if (alive) setLetterheadInfo(r); });
    return () => { alive = false; };
  }, [branding.letterheadUrl]);

  function updateDoctorDraft(userId, field, value) {
    setDoctorDrafts((d) => ({ ...d, [userId]: { ...d[userId], [field]: value } }));
  }

  async function handleSaveDoctorInfo(userId) {
    if (savingDoctorId) return; // guard against rapid double-submit
    setDoctorError('');
    setSavingDoctorId(userId);
    try {
      const draft = doctorDrafts[userId];
      await api.put(`/branding/doctors/${userId}`, { designation: draft.designation, signatureName: draft.signatureName });
      await loadDoctors();
    } catch (err) {
      setDoctorError(err.response?.data?.message || 'Failed to save doctor details');
    } finally {
      setSavingDoctorId(null);
    }
  }

  async function handleUploadSignature(userId, file) {
    if (!file || savingDoctorId) return;
    setDoctorError('');
    setSavingDoctorId(userId);
    const formData = new FormData();
    formData.append('signature', file);
    try {
      await api.post(`/branding/doctors/${userId}/signature`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await loadDoctors();
    } catch (err) {
      setDoctorError(err.response?.data?.message || 'Failed to upload signature');
    } finally {
      setSavingDoctorId(null);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (saving) return; // guard against a rapid double-submit
    setError('');
    setMessage('');
    setSaving(true);
    const formData = new FormData();
    if (logoFile) formData.append('logo', logoFile);
    if (letterheadFile) formData.append('letterhead', letterheadFile);
    formData.append('clientName', detailsForm.clientName);
    formData.append('address', detailsForm.address);
    formData.append('mobile', detailsForm.mobile);
    formData.append('email', detailsForm.email);
    formData.append('letterheadTopMm', detailsForm.letterheadTopMm);
    formData.append('letterheadBottomMm', detailsForm.letterheadBottomMm);
    try {
      const { data } = await api.post('/branding', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setBranding(data);
      setLogoFile(null);
      setLetterheadFile(null);
      setMessage('Branding updated. New bills/reports for this client will use it.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <div className="card">
      <h3>Report Branding</h3>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        Upload a logo and/or a letterhead image. A letterhead can be a header strip (printed at the top of the
        report) or a full A4 page (portrait) - a full page is printed behind the whole report, with the results
        inside its blank middle area (set the top/bottom space below to match your design). Without a letterhead, the logo (if any) is shown alongside the name below. The name/address/mobile/email below
        always appear on every bill copy and lab report, logo or not - this is separate from the
        name/address/contact details Chief Admin has on file for this account, so it's safe to customize for what
        patients should actually see without affecting anything on the Chief Admin side.
      </p>

      <form onSubmit={handleUpload}>
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label><span>Logo</span>
            <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} />
          </label>
          <label><span>Letterhead</span>
            <input type="file" accept="image/*" onChange={(e) => setLetterheadFile(e.target.files[0])} />
          </label>
        </div>
        <div className="form-grid">
          <label><span>Client / Branding Name</span>
            <input value={detailsForm.clientName} onChange={(e) => setDetailsForm((f) => ({ ...f, clientName: e.target.value }))} required />
          </label>
          <label><span>Address</span>
            <input value={detailsForm.address} onChange={(e) => setDetailsForm((f) => ({ ...f, address: e.target.value }))} />
          </label>
          <label><span>Mobile</span>
            <input value={detailsForm.mobile} onChange={(e) => setDetailsForm((f) => ({ ...f, mobile: e.target.value }))} />
          </label>
          <label><span>Email</span>
            <input value={detailsForm.email} onChange={(e) => setDetailsForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
        </div>
        <h4 style={{ marginTop: 6 }}>Full A4 Letterhead - Blank Space</h4>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
          Only used for a full-page letterhead: how far from the top and bottom edge the report starts and stops, so it
          doesn&apos;t print over your letterhead&apos;s header and footer. Also kept when printing without the header
          onto pre-printed letterhead paper. Leave blank to fit it automatically - just below your letterhead&apos;s
          header and just above its footer{letterheadIsPage ? ` (${autoTopMm} mm / ${autoBottomMm} mm for this letterhead)` : ''}.
        </p>
        <div className="form-grid">
          <label><span>Top space (mm)</span>
            <input type="number" min="0" max="120" placeholder={`Auto (${autoTopMm})`} value={detailsForm.letterheadTopMm} onChange={(e) => setDetailsForm((f) => ({ ...f, letterheadTopMm: e.target.value }))} />
          </label>
          <label><span>Bottom space (mm)</span>
            <input type="number" min="0" max="120" placeholder={`Auto (${autoBottomMm})`} value={detailsForm.letterheadBottomMm} onChange={(e) => setDetailsForm((f) => ({ ...f, letterheadBottomMm: e.target.value }))} />
          </label>
        </div>
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </form>

      {error && <p className="error-text">{error}</p>}
      {message && <p style={{ color: '#166534' }}>{message}</p>}

      <div className="branding-preview">
        <figure>
          {branding.logoUrl ? <img src={branding.logoUrl} alt="Logo preview" /> : <div style={{ width: 220, height: 120, background: '#f1f5f9', borderRadius: 8 }} />}
          <figcaption>Current Logo</figcaption>
        </figure>
        <figure>
          {branding.letterheadUrl ? (
            <img
              src={branding.letterheadUrl}
              alt="Letterhead preview"
            />
          ) : <div style={{ width: 220, height: 120, background: '#f1f5f9', borderRadius: 8 }} />}
          <figcaption>
            Current Letterhead
            {branding.letterheadUrl && (letterheadIsPage ? ' (full A4 page)' : ' (header strip)')}
          </figcaption>
        </figure>
        {branding.letterheadUrl && letterheadIsPage && (
          <figure>
            {/* Shaded box = where the report prints (live as the mm values above change). */}
            <div className="letterhead-a4-preview">
              <img src={branding.letterheadUrl} alt="" />
              <div
                className="letterhead-a4-zone"
                style={{
                  top: `${((Number(detailsForm.letterheadTopMm === '' ? autoTopMm : detailsForm.letterheadTopMm) || 0) / 297) * 100}%`,
                  bottom: `${((Number(detailsForm.letterheadBottomMm === '' ? autoBottomMm : detailsForm.letterheadBottomMm) || 0) / 297) * 100}%`,
                }}
              >
                Report prints here
              </div>
            </div>
            <figcaption>Print area preview</figcaption>
          </figure>
        )}
      </div>
    </div>

    <div className="card">
      <h3>Doctor Signature</h3>
      <p style={{ fontSize: 13, color: '#64748b' }}>
        Set a doctor name, designation and signature against whichever of your users should appear as the signing
        doctor. The name is whatever you type here - it doesn't need to match that user's login/account name.
        Whenever that user releases a lab report, this name, designation and signature print on the report footer -
        a user with nothing set here just won't show a signature on reports they release.
      </p>

      {doctorError && <p className="error-text">{doctorError}</p>}

      <table>
        <thead><tr><th>Login</th><th>Doctor Name (printed on report)</th><th>Designation</th><th>Signature</th><th></th></tr></thead>
        <tbody>
          {doctors.map((u) => {
            const draft = doctorDrafts[u.id] || { signatureName: '', designation: '' };
            const unchanged = draft.signatureName === (u.signatureName || '') && draft.designation === (u.designation || '');
            return (
              <tr key={u.id}>
                <td>{u.name || u.username}</td>
                <td>
                  <input
                    value={draft.signatureName}
                    onChange={(e) => updateDoctorDraft(u.id, 'signatureName', e.target.value)}
                    placeholder="e.g. Dr. Ramesh Kumar"
                    style={{ minWidth: 170 }}
                  />
                </td>
                <td>
                  <input
                    value={draft.designation}
                    onChange={(e) => updateDoctorDraft(u.id, 'designation', e.target.value)}
                    placeholder="e.g. MD, Pathologist"
                    style={{ minWidth: 160 }}
                  />
                </td>
                <td>
                  {u.signaturePath
                    ? <img src={u.signaturePath} alt="Signature" style={{ height: 32 }} />
                    : <span style={{ color: '#94a3b8', fontSize: 12 }}>Not set</span>}
                </td>
                <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={savingDoctorId === u.id || unchanged}
                    onClick={() => handleSaveDoctorInfo(u.id)}
                  >
                    Save
                  </button>
                  <label className="secondary" style={{ padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>
                    {u.signaturePath ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleUploadSignature(u.id, e.target.files[0])}
                    />
                  </label>
                </td>
              </tr>
            );
          })}
          {doctors.length === 0 && <tr><td colSpan={5}>No users found for this client yet.</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}
