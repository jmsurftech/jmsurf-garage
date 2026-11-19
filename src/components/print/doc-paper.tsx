import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  amountInWords, docColumns, docCompanyLines, docItemText, docMoney, docPartyLines, docTotalRows, fmtDate, fmtMoney, fmtSignedAt, ribbonFor, vatLabel, type DocModel,
} from "@/lib/doc-pdf";
import { FONT_SCALE, LOGO_HEIGHT, resolveDocSettings } from "@/lib/doc-settings";

/**
 * HTML rendering of a DocModel — the same document buildDocPdf() draws, with
 * the same template, colours, font size and show/hide settings — viewable on
 * any device without downloading. The A4 sheet (794px wide) is scaled down to
 * fit narrow screens.
 */
export function DocPaper({ model, className }: { model: DocModel; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(1, el.clientWidth / 794);
      setScale(s);
      setHeight(sheet.current ? sheet.current.offsetHeight * s : undefined);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);

  const m = model;
  const s = resolveDocSettings(m.settings);
  const T = s.template;
  const ccy = (m.currency || "KES").toUpperCase();
  const money = (n: unknown) => docMoney(n, ccy);
  const rib = s.header.showStatusRibbon && T !== "professional" ? ribbonFor(m.status) : null;
  const rows = docTotalRows(m);
  const cols = docColumns(s, m.items);
  const notes = s.other.showNotes ? m.sections.filter((x) => x.text?.trim() && !/terms/i.test(x.title)) : [];
  const terms = s.other.showTerms ? m.sections.filter((x) => x.text?.trim() && /terms/i.test(x.title)) : [];
  const payment = s.other.showBankDetails ? (m.payment ?? []).filter((p) => p.lines.some(Boolean)) : [];
  const sigs = s.other.showSignature || m.signedBy ? (m.signatures?.length ? m.signatures : [s.other.signatureLabel || "Authorized Signature"]) : [];
  const title = s.details.title.trim() || m.title;
  const k = FONT_SCALE[s.fontSize];
  // PDF points → CSS px at 96dpi on a 794px A4 sheet
  const px = (pt: number) => `${(pt * k * 1.333).toFixed(2)}px`;

  const vars = {
    "--zd-accent": s.colors.accent,
    "--zd-th": s.colors.tableHeader,
    "--zd-th-text": s.colors.tableHeaderText,
    "--zd-text": s.colors.text,
    "--zd-label": s.colors.label,
    "--zd-balance": s.colors.balanceBg,
    "--zd-body": px(8.5),
    "--zd-small": px(8),
    "--zd-label-size": px(8.5),
    "--zd-name": px(10.5),
    "--zd-title": px(24),
    "--zd-strong": px(9),
  } as CSSProperties;

  return (
    <div ref={outer} className={`zd-outer ${className ?? ""}`} style={{ height }}>
      <style>{CSS}</style>
      <div ref={sheet} className={`zd-sheet zd-t-${T}`} style={{ ...vars, transform: scale < 1 ? `scale(${scale})` : undefined }}>
        {T === "professional" && (
          <div className="zd-band">
            <h1 className="zd-title">{title}</h1>
            <div className="zd-number"># {m.number ?? "—"}</div>
          </div>
        )}
        {rib && (
          <div className="zd-ribbon" aria-label={`Status: ${rib.label}`}>
            <span style={{ background: `rgb(${rib.color.map((v) => Math.round(v * 255)).join(",")})` }}>{rib.label}</span>
          </div>
        )}
        <header className="zd-head">
          <div className="zd-company">
            {s.header.showLogo && m.company.logoUrl && (
              <img src={m.company.logoUrl} alt="" className="zd-logo"
                style={{ maxHeight: LOGO_HEIGHT[s.header.logoSize] * 1.333, marginLeft: rib ? 34 : 0 }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            )}
            {s.header.showCompanyName && <div className="zd-company-name">{m.company.name}</div>}
            {docCompanyLines(m, s).map((l, i) => <div key={i} className="zd-small">{l}</div>)}
          </div>
          <div className="zd-title-block">
            {T !== "professional" && (
              <>
                <h1 className="zd-title">{title}</h1>
                <div className="zd-number"># {m.number ?? "—"}</div>
              </>
            )}
            {m.highlight && s.totals.showBalanceDue && (
              <div className="zd-balance">
                <div className="zd-small zd-b">{m.highlight.label}</div>
                <div className="zd-balance-amt">{money(m.highlight.value)}</div>
              </div>
            )}
          </div>
        </header>

        <section className="zd-parties">
          <div className="zd-party-wrap">
            {[m.party, m.secondParty].filter(Boolean).map((p) => (
              <div key={p!.label} className="zd-party zd-box">
                <div className="zd-label">{p!.label}</div>
                <div className="zd-party-name">{p!.name}</div>
                {docPartyLines(p!, s).map((l, i) => <div key={i} className="zd-small">{l}</div>)}
              </div>
            ))}
          </div>
          {m.meta.length > 0 && (
            <table className="zd-meta zd-box">
              <tbody>
                {m.meta.map((r) => (
                  <tr key={r.label}><td>{r.label} :</td><td>{r.value}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {m.intro && <p className="zd-intro zd-muted zd-small">{m.intro}</p>}

        <table className="zd-items">
          <thead>
            <tr>{cols.map((c) => <th key={c.key} className={c.right ? "zd-r" : c.key === "n" ? "zd-c-n" : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {m.items.length === 0 && <tr><td className="zd-muted" colSpan={cols.length}>No line items</td></tr>}
            {m.items.map((it, i) => {
              const t = docItemText(it, s.table.showDescription);
              return (
                <tr key={i} className={s.table.stripedRows && i % 2 === 1 ? "zd-stripe" : undefined}>
                  {cols.map((c) => {
                    if (c.key === "n") return <td key={c.key} className="zd-c-n zd-muted">{i + 1}</td>;
                    if (c.key === "item") return (
                      <td key={c.key}>
                        <div className="zd-item-name">{t.name}</div>
                        {t.description && <div className="zd-desc">{t.description}</div>}
                      </td>
                    );
                    if (c.key === "qty") return <td key={c.key} className="zd-r">{fmtMoney(it.qty)}{it.unit && <div className="zd-unit">{it.unit}</div>}</td>;
                    if (c.key === "rate") return <td key={c.key} className="zd-r">{fmtMoney(it.unit_price)}</td>;
                    if (c.key === "tax") return <td key={c.key} className="zd-r">{vatLabel(it.tax_rate)}</td>;
                    return <td key={c.key} className="zd-r zd-amt">{fmtMoney(it.amount)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <section className="zd-sum">
          <div className="zd-words">
            {s.totals.showAmountInWords && (
              <>
                <div className="zd-muted zd-small">Total In Words</div>
                <div className="zd-words-text">{amountInWords(Number(m.totals.total) || 0, ccy)}</div>
              </>
            )}
          </div>
          <table className="zd-totals">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={r.kind ? `zd-${r.kind}` : undefined}>
                  <td>{r.label}</td>
                  <td>{typeof r.value === "number" ? money(r.value) : r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {notes.map((x) => <Block key={x.title} title={s.other.notesLabel || x.title} lines={[x.text]} />)}
        {payment.map((p) => <Block key={p.title} title={p.title} lines={p.lines.filter(Boolean)} />)}
        {terms.map((x) => <Block key={x.title} title={s.other.termsLabel || x.title} lines={[x.text]} />)}

        {m.kra && (m.kra.qrDataUrl || m.kra.rows.length > 0) && (
          <div className="zd-kra">
            <div className="zd-kra-brand">{m.kra.logo ? <img src="/brand/kra-logo.png" alt="Kenya Revenue Authority" className="zd-kra-logo" /> : <><span className="zd-kra-mark">KRA</span><span>KENYA REVENUE<br />AUTHORITY</span></>}</div>
            <p className="zd-kra-title">SCU INFORMATION</p>
            <div className="zd-kra-body">
              {m.kra.qrDataUrl && (m.kra.url ? <a href={m.kra.url} target="_blank" rel="noopener noreferrer"><img src={m.kra.qrDataUrl} alt="KRA eTIMS QR code" /></a> : <img src={m.kra.qrDataUrl} alt="KRA eTIMS QR code" />)}
              <div>
                <table><tbody>{m.kra.rows.map(([l, v]) => <tr key={l}><td>{l}</td><td>: {v}</td></tr>)}</tbody></table>
                <p className="zd-kra-hint">Scan the QR code to connect with KRA and verify the document.</p>
              </div>
            </div>
          </div>
        )}
        {sigs.length > 0 && (
          <div className="zd-sigs">
            {sigs.map((sg, i) => {
              const sb = i === 0 ? m.signedBy : null;
              return (
                <div key={sg} className="zd-sig"><span>{sg}</span>
                  <span className="zd-sig-line">
                    {sb?.stampUrl && <span className="zd-stamp"><img src={sb.stampUrl} alt="" /><b>{fmtDate(sb.at).toUpperCase()}</b></span>}
                    {sb?.signatureUrl && <img className="zd-sign" src={sb.signatureUrl} alt="" />}
                    {sb && <span className="zd-signed"><b>{sb.name}</b><br />{[sb.title, `Signed ${fmtSignedAt(sb.at)}`].filter(Boolean).join("  ·  ")}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {(m.footerNote || s.other.footerText) && <p className="zd-muted zd-small zd-footnote">{m.footerNote || s.other.footerText}</p>}
      </div>
    </div>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="zd-block">
      <div className="zd-block-title">{title}</div>
      {lines.map((l, i) => <p key={i} className="zd-small">{l}</p>)}
    </section>
  );
}

const CSS = `
.zd-outer { width: 100%; overflow: hidden; }
.zd-sheet { position: relative; width: 794px; min-height: 1123px; transform-origin: top left; background: #fff; color: var(--zd-text);
  font: var(--zd-body)/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif; padding: 53px 53px 60px; box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 10px 30px rgba(0,0,0,.08); overflow: hidden; }
.zd-sheet * { box-sizing: border-box; }
.zd-muted { color: var(--zd-label); }
.zd-small { font-size: var(--zd-small); }
.zd-label { font-size: var(--zd-body); margin-bottom: 2px; }
.zd-ribbon { position: absolute; top: 0; left: 0; width: 124px; height: 124px; overflow: hidden; pointer-events: none; }
.zd-ribbon span { position: absolute; top: 27px; left: -40px; width: 176px; transform: rotate(-45deg); color: #fff; text-align: center;
  font-size: 11px; font-weight: 700; letter-spacing: .04em; padding: 5px 0; }
.zd-band { margin: -53px -53px 28px; padding: 22px 53px 16px; background: var(--zd-th); color: var(--zd-th-text); text-align: right; }
.zd-band .zd-title, .zd-band .zd-number { color: var(--zd-th-text); }
.zd-head { display: flex; justify-content: space-between; gap: 24px; }
.zd-company { max-width: 42%; line-height: 1.45; }
.zd-logo { display: block; max-width: 280px; object-fit: contain; margin-bottom: 12px; }
.zd-company-name { font-weight: 700; font-size: var(--zd-strong); margin-bottom: 1px; }
.zd-b { font-weight: 700; }
.zd-unit { font-size: calc(var(--zd-small) - 1px); color: var(--zd-label); }
.zd-title-block { text-align: right; }
.zd-title { margin: 0; font-size: var(--zd-title); font-weight: 400; letter-spacing: .01em; color: var(--zd-accent); line-height: 1.1; }
.zd-t-spreadsheet .zd-title { font-weight: 700; }
.zd-number { font-weight: 700; font-size: var(--zd-strong); margin-top: 8px; }
.zd-balance { margin-top: 20px; }
.zd-balance-amt { font-weight: 700; font-size: calc(var(--zd-strong) * 1.25); margin-top: 2px; }
.zd-parties { display: flex; justify-content: space-between; gap: 24px; margin-top: 30px; }
.zd-party-wrap { display: flex; gap: 24px; flex: 1; min-width: 0; }
.zd-party { flex: 1; min-width: 0; }
.zd-party-name { font-weight: 700; font-size: var(--zd-small); }
.zd-meta { border-collapse: collapse; font-size: var(--zd-small); align-self: flex-start; }
.zd-meta td { padding: 3px 0 8px; text-align: right; vertical-align: top; }
.zd-meta td:first-child { font-size: var(--zd-body); }
.zd-meta td:first-child { padding-right: 16px; white-space: nowrap; }
.zd-meta td:last-child { min-width: 120px; max-width: 170px; }
.zd-t-spreadsheet .zd-box { border: 1px solid #d9d9de; padding: 12px; }
.zd-t-spreadsheet .zd-meta { border-collapse: separate; }
.zd-intro { margin: 18px 0 0; }
.zd-items { width: 100%; border-collapse: collapse; margin-top: 24px; }
.zd-items th { background: var(--zd-th); color: var(--zd-th-text); font-weight: 400; text-align: left; padding: 9px 10px; font-size: var(--zd-label-size); }
.zd-t-professional .zd-items th { background: var(--zd-accent); }
.zd-t-spreadsheet .zd-items th { background: color-mix(in srgb, var(--zd-th) 14%, white); color: var(--zd-accent); border: 1px solid #d9d9de; }
.zd-t-minimalist .zd-items th { background: transparent; color: var(--zd-accent); border-bottom: 2px solid var(--zd-th); }
.zd-items td { padding: 11px 10px; border-bottom: 1px solid #dcdce0; vertical-align: top; }
.zd-t-spreadsheet .zd-items td { border: 1px solid #dcdce0; }
.zd-items tr.zd-stripe td { background: color-mix(in srgb, var(--zd-th) 6%, white); }
.zd-items .zd-r { text-align: right; white-space: nowrap; }
.zd-c-n { width: 36px; }
.zd-item-name { font-weight: 400; }
.zd-amt { font-weight: 400; }
.zd-desc { color: var(--zd-label); font-size: var(--zd-small); margin-top: 3px; white-space: pre-line; }
.zd-sum { display: flex; justify-content: space-between; gap: 30px; margin-top: 14px; }
.zd-words { flex: 1; padding-top: 8px; }
.zd-words-text { font-weight: 700; font-style: italic; margin-top: 4px; }
.zd-totals { width: 360px; border-collapse: collapse; align-self: flex-start; }
.zd-t-spreadsheet .zd-totals { border: 1px solid #d9d9de; }
.zd-totals td { padding: 8px 10px; text-align: right; }
.zd-totals td:first-child { font-weight: 700; }
.zd-t-standard .zd-totals .zd-total td { border-top: 1px solid #dcdce0; }
.zd-totals tr:last-child.zd-total td, .zd-totals tr:last-child.zd-due td { background: var(--zd-balance); }
.zd-totals td:first-child { width: 52%; }
.zd-totals .zd-total td, .zd-totals .zd-due td { font-weight: 700; font-size: var(--zd-strong); }
.zd-t-minimalist .zd-totals .zd-total td { border-top: 2px solid var(--zd-th); }
.zd-t-professional .zd-totals .zd-total td { background: var(--zd-th); color: var(--zd-th-text); }
.zd-totals .zd-paid td:last-child { color: #d62e2e; }

.zd-block { margin-top: 24px; }
.zd-block-title { margin-bottom: 4px; font-size: var(--zd-body); }
.zd-block p { margin: 0; white-space: pre-line; }
.zd-kra { margin-top: 30px; break-inside: avoid; }
.zd-kra-brand { display: flex; align-items: center; gap: 8px; font-family: Georgia, "Times New Roman", serif; font-size: 18px; line-height: 1.05; letter-spacing: .02em; color: var(--zd-text); }
.zd-kra-mark { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 999px; background: #d1121c; color: #fff; font: 700 12px/1 Arial, sans-serif; }
.zd-kra-logo { height: 44px; width: auto; max-width: 200px; object-fit: contain; }
.zd-kra-title { margin: 10px 0 6px; font-weight: 700; font-size: var(--zd-body); }
.zd-kra-body { display: flex; align-items: flex-start; gap: 10px; }
.zd-kra-body img { width: 122px; height: 122px; display: block; }
.zd-kra-body table { border-collapse: collapse; font-size: var(--zd-body); }
.zd-kra-body td { padding: 0 0 2px; vertical-align: top; }
.zd-kra-body td:first-child { width: 170px; }
.zd-kra-hint { margin: 4px 0 0; color: var(--zd-label); font-size: var(--zd-body); }
.zd-sigs { display: flex; gap: 40px; margin-top: 56px; }
.zd-sig { display: flex; align-items: flex-end; gap: 8px; }
.zd-sig-line { position: relative; display: inline-block; width: 180px; border-bottom: 1px solid var(--zd-text); }
.zd-sign { position: absolute; left: 8px; bottom: -4px; max-width: 62%; max-height: 56px; object-fit: contain; z-index: 2; }
.zd-stamp { position: absolute; right: -14px; bottom: -32px; width: 98px; height: 98px; display: flex; align-items: center; justify-content: center; transform: rotate(8deg); opacity: .88; z-index: 1; }
.zd-stamp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.zd-stamp b { position: relative; font-size: 8.5px; letter-spacing: .02em; color: #1c3390; }
.zd-signed { position: absolute; left: 0; top: 4px; white-space: nowrap; font-size: calc(var(--zd-body) * .92); line-height: 1.35; color: var(--zd-label, #5e6369); }
.zd-signed b { color: var(--zd-text); }
.zd-sigs:has(.zd-signed) { margin-top: 80px; margin-bottom: 30px; }
.zd-footnote { margin-top: 18px; }
@media print {
  .zd-outer { height: auto !important; overflow: visible; }
  .zd-sheet { transform: none !important; box-shadow: none; width: 100%; min-height: 0; padding: 0; }
  .zd-band { margin: 0 0 24px; }
  .zd-sheet, .zd-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
