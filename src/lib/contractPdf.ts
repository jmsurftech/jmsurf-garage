// A contract as a PDF (download, print and the email attachment): the text with
// numbered clauses, then both signature blocks with signatures and our stamp.
import { PDFDocument, StandardFonts, rgb, degrees, PageSizes, type PDFFont, type PDFImage } from "pdf-lib";
import { contractBlocks } from "@/lib/contractTemplates";
import { fmtDate, fmtSignedAt } from "@/lib/doc-pdf";

export type PdfSigner = { name?: string | null; title?: string | null; at?: string | null; signatureUrl?: string | null; stampUrl?: string | null; uploaded?: boolean };

async function imageBytes(url?: string | null): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const b64 = url.split(",")[1] || "";
      const bin = atob(b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, png: url.startsWith("data:image/png") };
    }
    const r = await fetch(url);
    if (!r.ok) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), png: (r.headers.get("content-type") || "").includes("png") || /\.png($|\?)/i.test(url) };
  } catch { return null; }
}

// Helvetica (WinAnsi) cannot draw every character; replace the common ones.
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

export async function buildContractPdf(input: {
  title: string; body: string; number?: string | null; company: string; logoUrl?: string | null; roles: { us: string; them: string }; partyName: string;
  our?: PdfSigner | null; party?: PdfSigner | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.title} ${input.number || ""}`.trim());
  doc.setProducer("JMSURF Garage");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = PageSizes.A4;
  const M = 56, CW = W - M * 2;
  const ink = rgb(0.12, 0.12, 0.12), muted = rgb(0.37, 0.39, 0.41);
  let page = doc.addPage(PageSizes.A4);
  let y = H - M;
  const pages = [page];
  const newPage = () => { page = doc.addPage(PageSizes.A4); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of safe(text).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const t = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  const embed = async (src?: string | null): Promise<PDFImage | null> => {
    const b = await imageBytes(src);
    if (!b) return null;
    try { return b.png ? await doc.embedPng(b.bytes) : await doc.embedJpg(b.bytes); } catch { return null; }
  };

  // header
  const logo = await embed(input.logoUrl);
  let hx = M;
  if (logo) { const r = Math.min(30 / logo.height, 120 / logo.width); page.drawImage(logo, { x: M, y: y - 26, width: logo.width * r, height: logo.height * r }); hx = M + logo.width * r + 10; }
  page.drawText(safe(input.company), { x: hx, y: y - 16, size: 12, font: bold, color: ink });
  if (input.number) { const t = safe(input.number); page.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 9), y: y - 14, size: 9, font, color: muted }); }
  y -= 38;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.87) });
  y -= 22;

  const size = 9.8, LH = 13.6;
  for (const b of contractBlocks(input.body)) {
    if (b.kind === "title") {
      for (const l of wrap(b.text, bold, 13, CW)) { need(20); page.drawText(l, { x: M + (CW - bold.widthOfTextAtSize(l, 13)) / 2, y, size: 13, font: bold, color: ink }); y -= 18; }
      y -= 8;
    } else if (b.kind === "heading") {
      need(34); y -= 6;
      page.drawText(safe(`${b.num}. ${b.text}`), { x: M, y, size: 10, font: bold, color: ink }); y -= LH + 2;
    } else {
      const indent = b.kind === "clause" ? 30 : 0;
      const lines = wrap(b.text, font, size, CW - indent);
      lines.forEach((l, k) => {
        need(LH);
        if (k === 0 && b.num) page.drawText(b.num, { x: M, y, size, font, color: muted });
        page.drawText(l, { x: M + indent, y, size, font, color: ink }); y -= LH;
      });
      y -= 4;
    }
  }

  // signatures: two columns
  need(170); y -= 26;
  const colW = (CW - 40) / 2;
  const block = async (x: number, role: string, label: string, s?: PdfSigner | null) => {
    let yy = y;
    page.drawText(safe(role.toUpperCase()), { x, y: yy, size: 8, font: bold, color: muted }); yy -= 12;
    for (const l of wrap(label, font, 9, colW)) { page.drawText(l, { x, y: yy, size: 9, font, color: ink }); yy -= 12; }
    const lineY = yy - 62;
    const stamp = await embed(s?.stampUrl);
    if (stamp) {
      const r = Math.min(72 / stamp.width, 72 / stamp.height), w = stamp.width * r, h = stamp.height * r;
      const th = (-8 * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
      const cx = x + colW - w / 2, cy = lineY + 10;
      page.drawImage(stamp, { x: cx - (w / 2) * cos + (h / 2) * sin, y: cy - (w / 2) * sin - (h / 2) * cos, width: w, height: h, rotate: degrees(-8), opacity: 0.88 });
      if (s?.at) {
        const dt = fmtDate(s.at).toUpperCase(), ds = 6.5, tw = bold.widthOfTextAtSize(dt, ds);
        page.drawText(dt, { x: cx - (tw / 2) * cos + ds * 0.35 * sin, y: cy - (tw / 2) * sin - ds * 0.35 * cos, size: ds, font: bold, color: rgb(0.11, 0.2, 0.55), rotate: degrees(-8) });
      }
    }
    const sig = await embed(s?.signatureUrl);
    if (sig) { const r = Math.min((colW * 0.62) / sig.width, 50 / sig.height); page.drawImage(sig, { x: x + 4, y: lineY - 3, width: sig.width * r, height: sig.height * r }); }
    else if (s?.uploaded) page.drawText("Signed copy on file", { x: x + 4, y: lineY + 6, size: 8, font, color: muted });
    page.drawLine({ start: { x, y: lineY }, end: { x: x + colW, y: lineY }, thickness: 0.8, color: ink });
    const rows = [`Name: ${s?.name || "______________________"}`, `Title: ${s?.title || "______________________"}`, `Date: ${s?.at ? fmtSignedAt(s.at) : "______________________"}`];
    rows.forEach((t, k) => page.drawText(safe(t), { x, y: lineY - 14 - k * 12, size: 9, font: k === 0 ? bold : font, color: ink }));
  };
  await block(M, input.roles.us, `For and on behalf of ${input.company}`, input.our);
  await block(M + colW + 40, input.roles.them, `For and on behalf of ${input.partyName}`, input.party);

  pages.forEach((p, i) => {
    const t = `${safe(input.number || input.title)}  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 7.5), y: M - 24, size: 7.5, font, color: muted });
  });
  return await doc.save();
}
