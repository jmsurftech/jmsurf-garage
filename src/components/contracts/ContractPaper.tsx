import { contractBlocks } from "@/lib/contractTemplates";
import { fmtDate, fmtSignedAt } from "@/lib/doc-pdf";

export type PaperSigner = { name?: string | null; title?: string | null; at?: string | null; signatureUrl?: string | null; stampUrl?: string | null; uploaded?: boolean };

/** A contract as a printed page: the text with numbered clauses, then both signature blocks. */
export function ContractPaper({ body, number, company, logoUrl, roles, partyName, our, party, className = "" }: {
  body: string; number?: string | null; company: string; logoUrl?: string | null; roles: { us: string; them: string }; partyName: string;
  our?: PaperSigner | null; party?: PaperSigner | null; className?: string;
}) {
  const blocks = contractBlocks(body);
  return (
    <article className={`ct-paper mx-auto max-w-[820px] rounded-xl bg-white px-6 py-8 text-[13px] leading-relaxed text-[#1f1f1f] shadow-sm ring-1 ring-black/5 sm:px-12 sm:py-12 ${className}`}>
      <header className="mb-6 flex items-center justify-between gap-4 border-b border-black/10 pb-4">
        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="" className="h-10 w-auto max-w-[140px] object-contain" />}
          <b className="text-[15px]">{company}</b>
        </div>
        {number && <span className="text-xs text-[#5e6369]">{number}</span>}
      </header>
      {blocks.map((b, i) => b.kind === "title"
        ? <h1 key={i} className="mb-5 text-center text-[17px] font-bold tracking-wide">{b.text}</h1>
        : b.kind === "heading"
          ? <h2 key={i} className="mb-2 mt-5 text-[13px] font-bold tracking-wide">{b.num}. {b.text}</h2>
          : b.kind === "clause"
            ? <p key={i} className="mb-2 flex gap-2 text-justify"><span className="min-w-[2.2rem] shrink-0 text-[#5e6369]">{b.num}</span><span className="whitespace-pre-line">{b.text}</span></p>
            : <p key={i} className="mb-2 whitespace-pre-line text-justify">{b.text}</p>)}
      <section className="mt-10 grid gap-10 sm:grid-cols-2 print:grid-cols-2">
        <SignBlock label={`For and on behalf of ${company}`} role={roles.us} s={our} />
        <SignBlock label={`For and on behalf of ${partyName}`} role={roles.them} s={party} />
      </section>
    </article>
  );
}

function SignBlock({ label, role, s }: { label: string; role: string; s?: PaperSigner | null }) {
  const signed = !!s?.at;
  return (
    <div className="break-inside-avoid">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#5e6369]">{role}</p>
      <p className="mb-2 text-[12px]">{label}</p>
      <div className="relative h-[86px] border-b border-[#1f1f1f]">
        {s?.stampUrl && (
          <span className="absolute -bottom-7 right-0 flex h-[96px] w-[96px] rotate-[8deg] items-center justify-center opacity-90">
            <img src={s.stampUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
            {s.at && <b className="relative text-[8.5px] tracking-wide text-[#1c3390]">{fmtDate(s.at).toUpperCase()}</b>}
          </span>
        )}
        {s?.signatureUrl && <img src={s.signatureUrl} alt="Signature" className="absolute bottom-[-4px] left-1 z-[1] max-h-[70px] max-w-[64%] object-contain" />}
        {!s?.signatureUrl && s?.uploaded && <span className="absolute bottom-2 left-1 text-xs italic text-[#5e6369]">Signed copy on file</span>}
      </div>
      <div className="mt-2 space-y-0.5 text-[12px]">
        <p>Name: <b>{s?.name || "______________________"}</b></p>
        <p>Title: {s?.title || "______________________"}</p>
        <p>Date: {signed ? fmtSignedAt(s!.at!) : "______________________"}</p>
      </div>
    </div>
  );
}
