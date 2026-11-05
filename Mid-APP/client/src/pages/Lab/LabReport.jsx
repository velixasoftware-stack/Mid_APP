import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import QRCode from 'qrcode';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import ShareButton from '../../components/ShareButton';
import { ReportRemarks } from '../../components/Remarks';
import { doctorLabel, patientLabel, formatDateDMY } from '../../utils/format';
import Sparkline from '../../components/Sparkline';
import { rangeLabel } from '../../components/NormalRangeText';
import { analyzeLetterhead, DEFAULT_LETTERHEAD_TOP_MM, DEFAULT_LETTERHEAD_BOTTOM_MM } from '../../utils/letterhead';

/** Day-Month-Year and time, e.g. "16-OCT-2026 05:11 PM". */
function formatDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${formatDateDMY(date)} ${time}`;
}

/** Letterhead (or its reserved blank space) + title + patient details - printed identically at the top of every page. */
function ReportHeader({ report, includeHeader, releasedAt, onImageLoad, pageLetterhead, qr }) {
  const { patient, client } = report;
  // When the first sample on this report was collected.
  const collectedAt = (report.tests || []).map((t) => t.collectedAt).filter(Boolean).sort()[0];
  return (
    <>
      {/* A full-page letterhead is the page's own background (see LabReport) -
          its header design already sits in the page's top margin, so no
          header slot here at all. */}
      {!pageLetterhead && (<>
      {/* Always reserves the same space here, header shown or not - so a
          report printed without the digital header (onto paper that
          already has the lab's letterhead pre-printed on it) leaves that
          same blank area at the top instead of the content shifting up
          and colliding with the physical letterhead. */}
      {/* With the letterhead image shown, the slot is exactly the image's height (no empty band under a wide letterhead). */}
      <div className={`report-header-slot${includeHeader && client.letterheadUrl ? ' has-letterhead' : ''}`}>
        {includeHeader && (client.letterheadUrl ? (
          <img src={client.letterheadUrl} alt="Letterhead" className="report-letterhead" onLoad={onImageLoad} />
        ) : (
          <div className="report-header">
            {client.logoUrl && <img src={client.logoUrl} alt="Logo" className="report-logo" />}
            <div>
              <h2 style={{ margin: 0 }}>{client.clientName}</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                {[client.address, client.mobile, client.email].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        ))}
      </div>
      </>)}

      {/* Two columns of "Label : Value" rows (left: patient, right: order) -
          compact, so the results start higher up the page. Read row by row:
          each pair below is one row, left then right. */}
      {/* The report's QR code sits at the right of the patient details box (on
          every page) - scanning it opens this report online. qr = '' while the
          image is being made: an empty box of the same size keeps the layout. */}
      <div className={`lab-report-info-box${qr != null ? ' has-qr' : ''}`}>
      <div className="lab-report-info">
        <div><span>Patient Name</span><strong>{patientLabel(patient)}</strong></div>
        <div><span>Order ID</span><strong>{report.bill.billNo}</strong></div>
        <div><span>Age / Gender</span><strong>{patient?.age ? `${patient.age} Yrs` : '—'} / {patient?.gender || '—'}</strong></div>
        <div><span>Order Date</span><strong>{formatDateTime(report.bill.createdAt)}</strong></div>
        <div><span>UMR</span><strong>{patient?.umr}</strong></div>
        <div><span>Collection Date</span><strong>{formatDateTime(collectedAt)}</strong></div>
        <div><span>Referred By</span><strong>{doctorLabel(report.bill.referredDoctor) || 'Self'}</strong></div>
        <div><span>Report Date</span><strong>{formatDateTime(releasedAt)}</strong></div>
      </div>
      {qr != null && (
        <div className="report-qr" title="Scan to view this report">
          {qr ? <img src={qr} alt="QR code - scan to view this report" /> : <span className="report-qr-box" />}
        </div>
      )}
      </div>
    </>
  );
}

function ParamTableHead() {
  return <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Bio. Ref. Interval</th></tr></thead>;
}

/**
 * The report body as a flat list of the smallest pieces a page may break
 * between: a test's title, each result row, and each block below it
 * (interpretation, remarks), then the trend rows, signature and disclaimer.
 * testIdx ties a piece to its test, so a page can regroup its pieces into
 * that test's title + table + notes (and repeat the table head / mark it
 * "contd." when the test carries on from the previous page).
 */
function SignatureBlock({ doctor }) {
  return (
    <div style={{ paddingTop: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ textAlign: 'center' }}>
        {doctor.signatureUrl && (
          <img src={doctor.signatureUrl} alt="Signature" style={{ height: 50, display: 'block', margin: '0 auto 4px' }} />
        )}
        <div style={{ minWidth: 160 }}>
          <strong style={{ fontSize: 13 }}>{doctor.name}</strong>
          {doctor.designation && <div style={{ fontSize: 12, color: '#64748b' }}>{doctor.designation}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Tests are laid out service group by service group (server order:
 * Haematology, Biochemistry, then the rest): each group after the first starts
 * on a new page, with its name above its tests and its own signature after them.
 * When the AI trend is included, each test's trend rows print right under
 * that test - so they stay inside its service group, before the signature.
 */
function buildUnits({ groups, trend, includeTrend }) {
  const units = [];
  const trendRows = includeTrend && trend ? trend.parameters : [];
  const trendByBarcode = new Map();
  for (const p of trendRows) trendByBarcode.set(p.barcode, [...(trendByBarcode.get(p.barcode) || []), p]);
  const placed = new Set();

  let testIdx = 0;
  groups.forEach((g, gi) => {
    // The service group's name heads its tests.
    units.push({
      key: `g${gi}-head`, kind: 'block', testIdx: null, keepWithNext: true, pageBreakBefore: gi > 0,
      node: (
        <div className={`report-group-head${gi > 0 ? ' report-group-break' : ''}`}>
          {g.name && <div className="report-group-title">{g.name}</div>}
        </div>
      ),
    });
    g.tests.forEach((t) => {
      const rows = (t.barcode && trendByBarcode.get(t.barcode)) || [];
      rows.forEach((r) => placed.add(r));
      addTestUnits(units, t, testIdx++, rows);
    });
    if (g.doctor) {
      units.push({ key: `g${gi}-sig`, kind: 'block', testIdx: null, keepWithPrevious: true, node: <SignatureBlock doctor={g.doctor} /> });
    }
  });
  addTrailingUnits(units, { unplacedTrend: trendRows.filter((r) => !placed.has(r)), hasTrend: trendRows.length > 0 });
  return units;
}

/** One trend row: parameter + insight on the left, sparkline with values on the right. */
function TrendRow({ p, showTest = false }) {
  return (
    <div className="trend-row">
      <div className="trend-row-main">
        <strong>{p.parameterName}</strong>
        {showTest && <span style={{ color: '#94a3b8', fontSize: 12 }}> · {p.testName}</span>}
        <p style={{ margin: '4px 0 0', fontSize: 13 }}>{p.insight}</p>
      </div>
      {/* The last few visits (server sends up to 3, this one last), each
          point labelled with its result value. */}
      <div className="trend-row-chart">
        <Sparkline points={p.history} showValues />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {p.history.length} recorded value{p.history.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

const AI_BADGE = <span className="trend-ai-badge">AI</span>;

function addTestUnits(units, t, testIdx, trendRows = []) {
  const hasValue = (p) => p.value != null && p.value.toString().trim() !== '';
  // Parameters left empty at result entry are optional and not printed.
  const numericParams = t.parameters.filter((p) => !p.isInterpretation && hasValue(p));
  const interpretationParams = t.parameters.filter((p) => p.isInterpretation && hasValue(p));
  units.push({ key: `t${testIdx}`, kind: 'title', testIdx, title: t.testName });
  numericParams.forEach((p) => units.push({
    key: `t${testIdx}-r-${p.parameterName}`, kind: 'row', testIdx,
    node: (
      <tr>
        <td>{p.parameterName}</td>
        <td style={p.isAbnormal ? { color: '#b91c1c', fontWeight: 700 } : undefined}>{p.value}</td>
        <td>{p.unit || '—'}</td>
        {/* The printed Normal Range text when set (may be several lines), else low - high. */}
        <td className="report-ref-range">{rangeLabel(p)}</td>
      </tr>
    ),
  }));
  interpretationParams.forEach((p) => units.push({
    key: `t${testIdx}-i-${p.parameterName}`, kind: 'block', testIdx,
    node: (
      <div className="report-unit-pad">
        <strong>{p.parameterName}</strong>
        <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{p.value}</p>
      </div>
    ),
  }));
  // "Sample Type: Serum" in bold right after the test's results - kept on the
  // same page as its last result row.
  if (t.sampleType && t.sampleType.trim()) {
    units.push({
      key: `t${testIdx}-sample`, kind: 'block', testIdx, keepWithPrevious: true,
      node: <div className="report-sample-type"><strong>Sample Type: {t.sampleType}</strong></div>,
    });
  }
  if (t.interpretation) {
    units.push({
      key: `t${testIdx}-interp`, kind: 'block', testIdx,
      node: (
        <div className="report-unit-pad">
          <strong>Interpretation</strong>
          <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', color: '#475569' }}>{t.interpretation}</p>
        </div>
      ),
    });
  }
  if (t.remarks && t.remarks.trim()) {
    units.push({ key: `t${testIdx}-rem`, kind: 'block', testIdx, node: <ReportRemarks text={t.remarks} /> });
  }
  if (trendRows.length > 0) {
    // Label kept with the first trend row so it's never stranded at a page foot.
    units.push({
      key: `t${testIdx}-trend-head`, kind: 'block', testIdx, keepWithNext: true,
      node: <div className="trend-test-head">{AI_BADGE} Trend</div>,
    });
    trendRows.forEach((p) => units.push({
      key: `t${testIdx}-trend-${p.parameterName}`, kind: 'block', testIdx,
      node: <TrendRow p={p} />,
    }));
  }
}

// After every group: any trend row not matched to a test on the report (e.g.
// from an older server without barcodes), then the disclaimer.
function addTrailingUnits(units, { unplacedTrend, hasTrend }) {
  if (unplacedTrend.length > 0) {
    units.push({
      key: 'trend-head', kind: 'block', testIdx: null, keepWithNext: true,
      node: <div className="trend-test-head" style={{ paddingTop: 24 }}>{AI_BADGE} AI Trend Report</div>,
    });
    unplacedTrend.forEach((p) => units.push({
      key: `trend-${p.testName}-${p.parameterName}`, kind: 'block', testIdx: null,
      node: <TrendRow p={p} showTest />,
    }));
  }

  units.push({
    key: 'disclaimer', kind: 'block', testIdx: null, keepWithPrevious: true,
    node: (
      <p style={{ paddingTop: 18, margin: 0, fontSize: 12, color: '#64748b' }}>
        This is a system-generated report. Values in <span style={{ color: '#b91c1c', fontWeight: 700 }}>red</span> are
        outside the normal reference range. Please correlate clinically.
        {hasTrend && ' AI Trend compares against this patient\'s own past results for the same parameter - it is not a clinical diagnosis.'}
      </p>
    ),
  });
}

/**
 * Renders a run of units, regrouping consecutive pieces of one test into its
 * title + one table + its notes. contdTitle marks a test whose title was on
 * an earlier page.
 */
function UnitRun({ units }) {
  const out = [];
  let i = 0;
  while (i < units.length) {
    const u = units[i];
    if (u.testIdx == null) {
      out.push(<div key={u.key} className="report-unit">{u.node}</div>);
      i += 1;
      continue;
    }
    const group = [];
    while (i < units.length && units[i].testIdx === u.testIdx) group.push(units[i++]);
    const title = group.find((g) => g.kind === 'title');
    const rows = group.filter((g) => g.kind === 'row');
    const blocks = group.filter((g) => g.kind === 'block');
    out.push(
      <div key={`g-${u.key}`} className="report-test-block">
        <h4 className="report-test-title">{title ? title.title : `${u.contdTitle} (contd.)`}</h4>
        {rows.length > 0 && (
          <table className="report-param-table">
            <ParamTableHead />
            <tbody>{rows.map((r) => <Fragment key={r.key}>{r.node}</Fragment>)}</tbody>
          </table>
        )}
        {blocks.map((b) => <div key={b.key} className="report-unit">{b.node}</div>)}
      </div>,
    );
  }
  return out;
}

/**
 * Packs units onto A4 pages, given each unit's measured height and the room
 * left on a page under the repeated header. A test that carries over to a new
 * page costs an extra "(contd.)" title there, plus a table head if its rows
 * continue.
 */
function paginate(units, h) {
  const pages = [];
  let page = null;
  const newPage = () => { page = { units: [], used: 0, titled: new Set(), tabled: new Set() }; pages.push(page); };
  newPage();

  const costOf = (u, pg) => {
    let cost = h.units[u.key] || 0;
    if (u.testIdx != null && u.kind !== 'title' && !pg.titled.has(u.testIdx)) cost += h.contdTitle;
    if (u.kind === 'row' && !pg.tabled.has(u.testIdx)) cost += h.tableHead;
    return cost;
  };

  // Height of the start of a test (title + table head + first row/note), so a
  // heading is never stranded at a page foot without it.
  const testStartNeed = (i) => {
    const title = units[i];
    const first = units[i + 1];
    let need = h.units[title.key] || 0;
    if (first && first.testIdx === title.testIdx) need += (h.units[first.key] || 0) + (first.kind === 'row' ? h.tableHead : 0);
    return need;
  };

  units.forEach((u, i) => {
    // A new service group always starts on a fresh page.
    if (u.pageBreakBefore && page.units.length > 0) newPage();
    let cost = costOf(u, page);
    // Keep a test's title with its table head and first row (or first note),
    // a group heading with its first test's start, and the trend heading with
    // its first row - never stranded at a page foot.
    let need = cost;
    const next = units[i + 1];
    if (u.kind === 'title') {
      need = testStartNeed(i);
    } else if (u.keepWithNext && next) {
      need += next.kind === 'title' ? testStartNeed(i + 1) : (h.units[next.key] || 0);
    }
    // A group's signature and the closing disclaimer never sit alone on a
    // page - the piece before them (the last result row/note) moves over
    // with the whole chain if it doesn't all fit.
    for (let j = i + 1; units[j]?.keepWithPrevious; j += 1) need += h.units[units[j].key] || 0;
    if (page.units.length > 0 && page.used + need > h.available) {
      newPage();
      cost = costOf(u, page);
    }
    if (u.testIdx != null && u.kind !== 'title' && !page.titled.has(u.testIdx)) {
      const titleUnit = units.find((x) => x.kind === 'title' && x.testIdx === u.testIdx);
      page.units.push({ ...u, contdTitle: titleUnit?.title });
    } else {
      page.units.push(u);
    }
    if (u.testIdx != null) page.titled.add(u.testIdx);
    if (u.kind === 'row') page.tabled.add(u.testIdx);
    page.used += cost;
  });
  return pages.map((p) => p.units);
}

/**
 * A whole A4 page letterhead (portrait) is printed as each page's background
 * with the report on top of it; a header strip stays a header image above the
 * patient details. Also returns where the page letterhead's own header and
 * footer end, so the report fits between them (see utils/letterhead.js).
 */
function usePageLetterhead(url) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    setInfo(null);
    let alive = true;
    analyzeLetterhead(url).then((r) => { if (alive) setInfo(r); });
    return () => { alive = false; };
  }, [url]);
  return info?.isPage ? info : null;
}

/**
 * The lab report. Opened from Orders by bill (logged in), or - with
 * `publicToken` - from the QR code printed on a report (/r/<token>, no login,
 * view and print only).
 */
export default function LabReport({ publicToken } = {}) {
  const { billId } = useParams();
  const [report, setReport] = useState(null);
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState('');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeTrend, setIncludeTrend] = useState(false); // trend prints only once this is ticked
  const [heights, setHeights] = useState(null);
  const [qrImage, setQrImage] = useState('');
  const measureRef = useRef(null);

  useEffect(() => {
    if (publicToken) {
      api.get(`/public/reports/${publicToken}`)
        .then((r) => setReport(r.data))
        .catch((err) => setError(err.response?.status === 404 ? 'This report link is not valid, or the report is not available any more.' : (err.response?.data?.message || 'Failed to load report')));
      return;
    }
    api.get(`/report-view/bills/${billId}/report`)
      .then((r) => setReport(r.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load report'));
    // The AI trend report is a bonus add-on - if it fails for any reason, the
    // main report above still renders fine without it.
    api.get(`/report-view/bills/${billId}/trend`)
      // Only parameters the lab ticked "Trend" for come back - none ticked, no section.
      .then((r) => setTrend(r.data?.parameters?.length ? r.data : null))
      .catch(() => setTrend(null));
  }, [billId, publicToken]);

  // QR code (printed bottom-left on every page) opening this report's public
  // link - patient details and results, no login needed.
  const reportLink = report?.reportToken ? `${window.location.origin}/r/${report.reportToken}` : '';
  useEffect(() => {
    if (!reportLink) return undefined;
    let alive = true;
    QRCode.toDataURL(reportLink, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setQrImage(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [reportLink]);

  // Older server responses have no groups - treat them as one unnamed group.
  const units = useMemo(() => (report ? buildUnits({
    groups: report.groups || [{ name: null, tests: report.tests, doctor: report.doctor }],
    trend,
    includeTrend,
  }) : []), [report, trend, includeTrend]);

  // Measures every unit at the printed page's exact width (in a hidden copy)
  // so the print pages can be packed without anything spilling past a page.
  const measure = useCallback(() => {
    const root = measureRef.current;
    if (!root) return;
    const px = (sel) => root.querySelector(sel)?.getBoundingClientRect().height || 0;
    const unitHeights = {};
    root.querySelectorAll('[data-unit]').forEach((el) => { unitHeights[el.dataset.unit] = el.getBoundingClientRect().height; });
    const pageBody = px('[data-probe="body"]');
    if (!pageBody) return; // not laid out (e.g. already in print media) - keep the last measurement
    setHeights({
      units: unitHeights,
      tableHead: px('[data-probe="thead"]'),
      contdTitle: px('[data-probe="title"]'),
      // A few px of slack absorbs sub-pixel rounding between measure and print.
      available: pageBody - px('[data-probe="header"]') - px('[data-probe="footer"]') - 6,
    });
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, units, includeHeader]);
  useEffect(() => { document.fonts?.ready.then(measure); }, [measure]);

  // Images (letterhead, signature) can change heights once loaded, and fonts
  // may settle late - re-measure right before printing, synchronously.
  useEffect(() => {
    const onBeforePrint = () => flushSync(() => measure());
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [measure]);

  const pageLetterheadInfo = usePageLetterhead(report?.client?.letterheadUrl);
  const pageLetterhead = !!pageLetterheadInfo;
  useLayoutEffect(() => { measure(); }, [measure, pageLetterhead]);

  const pages = useMemo(() => (heights ? paginate(units, heights) : [units]), [units, heights]);

  if (error) return <div className="card"><p className="error-text">{error}</p></div>;
  if (!report) return <p>Loading…</p>;

  const { tests } = report;
  const releasedAt = tests.map((t) => t.releasedAt).filter(Boolean).sort().slice(-1)[0];
  // The letterhead's height is only known once its image loads - re-measure then so pages split correctly.
  const header = <ReportHeader report={report} includeHeader={includeHeader} releasedAt={releasedAt} onImageLoad={measure} pageLetterhead={pageLetterhead} qr={reportLink ? qrImage : null} />;
  // Full-page letterhead: the report prints inside its blank middle - just
  // below its header, just above its footer (a lab's own Report Branding
  // values win over the detected ones). The same space is kept with the
  // header unticked, for printing onto pre-printed letterhead paper.
  const pageClass = pageLetterhead ? ' has-page-letterhead' : '';
  const pageStyle = pageLetterhead ? {
    paddingTop: `${report.client.letterheadTopMm ?? pageLetterheadInfo.topMm ?? DEFAULT_LETTERHEAD_TOP_MM}mm`,
    paddingBottom: `${report.client.letterheadBottomMm ?? pageLetterheadInfo.bottomMm ?? DEFAULT_LETTERHEAD_BOTTOM_MM}mm`,
  } : undefined;
  // An <img>, not a CSS background - browsers skip backgrounds when printing by default.
  const pageBackground = pageLetterhead && includeHeader
    ? <img src={report.client.letterheadUrl} alt="" className="report-page-bg" onLoad={measure} />
    : null;
  // Page footer: the page number.
  const footer = (label, probe = false) => (
    <div className="report-print-footer" {...(probe ? { 'data-probe': 'footer' } : {})}>{label}</div>
  );

  return (
    <div>
      <div className="no-print report-toolbar">
        {publicToken ? (
          <strong className="public-report-title">{report.client.clientName} — Lab Report</strong>
        ) : (
          <Link to="/app/orders">&larr; Back to Orders</Link>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, fontWeight: 'normal' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={includeHeader} onChange={(e) => setIncludeHeader(e.target.checked)} />
          Include letterhead/logo header
        </label>
        {/* Always offered; ticking it adds the trend for the parameters the
            lab ticked "Trend" for in Test Parameters. */}
        {!publicToken && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, fontWeight: 'normal' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={includeTrend} onChange={(e) => setIncludeTrend(e.target.checked)} />
            Include AI Trend Report
          </label>
        )}
        {includeTrend && !trend && (
          <span style={{ fontSize: 12, color: '#b45309' }}>
            No trend parameters on this report - tick "Trend" against parameters in Test Parameters.
          </span>
        )}
        <div className="report-toolbar-actions">
          {!publicToken && <ShareButton apiPath={`/report-view/bills/${billId}/report/share`} />}
          <button onClick={() => window.print()}>Print Report</button>
        </div>
      </div>

      {/* On screen: one continuous sheet. */}
      <div className={`report-sheet report-screen-only${pageClass}`} style={pageStyle}>
        {pageBackground}
        {header}
        <UnitRun units={units} />
      </div>

      {/* The report prints on A4 - set only while this page is open, so bills
          and other printouts keep the printer's own paper size. */}
      <style>{'@page { size: A4; margin: 0; }'}</style>

      {/* Printed: real A4 pages, each starting with the same letterhead +
          patient details as page 1. */}
      <div className="report-print-pages">
        {pages.map((pageUnits, i) => (
          <div className={`report-print-page${pageClass}`} style={pageStyle} key={i}>
            {pageBackground}
            <div className="report-print-header">{header}</div>
            <div className="report-print-body"><UnitRun units={pageUnits} /></div>
            {footer(`Page ${i + 1} of ${pages.length}`)}
          </div>
        ))}
      </div>

      {/* Hidden measuring copy at the printed page's width. */}
      <div className="report-measure" ref={measureRef} aria-hidden="true">
        <div className={`report-print-page${pageClass}`} style={{ ...pageStyle, height: 'auto' }}>
          <div className="report-print-header" data-probe="header">{header}</div>
          {footer('Page 1 of 1', true)}
        </div>
        <div className={`report-print-page report-measure-body${pageClass}`} style={pageStyle}><div data-probe="body" style={{ height: '100%' }} /></div>
        <div className="report-print-page" style={{ height: 'auto' }}>
          <div className="report-test-block" data-probe="title"><h4 className="report-test-title">Title (contd.)</h4></div>
          <table className="report-param-table"><thead data-probe="thead"><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Bio. Ref. Interval</th></tr></thead></table>
          {units.map((u) => {
            if (u.kind === 'title') {
              return <div key={u.key} data-unit={u.key} className="report-test-block"><h4 className="report-test-title">{u.title}</h4></div>;
            }
            if (u.kind === 'row') {
              return <table key={u.key} className="report-param-table"><tbody data-unit={u.key}>{u.node}</tbody></table>;
            }
            return <div key={u.key} data-unit={u.key} className="report-unit">{u.node}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
