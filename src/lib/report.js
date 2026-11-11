import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { inr, num, fmtDate, fmtPct, sumDays } from './calc.js';

const cur = (n) => 'Rs ' + Math.round(n || 0).toLocaleString('en-IN'); // PDF fonts can't draw the rupee sign
const nowIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

/** td / prevTd = buildTeamDays rows for the period and the equal-length period right before it. sups, teams for names. */
export function makeRangeReport(from, to, td, prevTd, sups) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 14;
  const tot = sumDays(td), prev = sumDays(prevTd);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(25, 103, 210);
  doc.text('FINISHING - PRODUCTION & LABOUR REPORT', M, 18);
  doc.setFontSize(10.5); doc.setTextColor(60); doc.setFont('helvetica', 'normal');
  doc.text(`${fmtDate(from)}  to  ${fmtDate(to)}   (${days(from, to)} days)`, M, 25);
  doc.setFontSize(8.5); doc.setTextColor(120); doc.text('Propskart  |  Urban Pebbles   -   Labour % = labour cost / value produced x 100 (lower is better)', M, 30);
  doc.setDrawColor(25, 103, 210); doc.setLineWidth(0.6); doc.line(M, 32, W - M, 32);

  const rightHead = (d) => { if (d.section !== 'head' && d.section !== 'foot') return; if (d.column.index > 0) d.cell.styles.halign = 'right'; };
  const head = { fillColor: [25, 103, 210], textColor: 255, fontSize: 9.5 };
  const num3 = { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } };
  const heads = (f) => [[f, 'Units', 'Value', 'Labour cost', 'Labour %']];
  const line = (name, s) => [name, num(s.units), cur(s.value), cur(s.wage), fmtPct(s.pct)];
  const h = (t, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(30); doc.text(t, M, y); };

  // summary + comparison
  h('Summary', 40);
  const d = tot.pct - prev.pct, can = prev.value > 0 && tot.value > 0;
  autoTable(doc, {
    startY: 43, theme: 'grid', styles: { fontSize: 10, cellPadding: 2.6, lineColor: [210, 214, 220], lineWidth: 0.2 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [243, 246, 251], cellWidth: 52 } },
    body: [
      ['Units produced', num(tot.units)], ['Value produced', cur(tot.value)], ['Labour cost', cur(tot.wage)],
      ['Labour % of value', fmtPct(tot.pct)],
      ['Previous period', can ? `${fmtPct(prev.pct)}  (${fmtDate(new Date(new Date(from) - days(from, to) * 86400000).toISOString().slice(0, 10))} to ${fmtDate(new Date(new Date(from) - 86400000).toISOString().slice(0, 10))})` : 'No earlier data'],
      ['Change vs previous', can ? `${d <= 0 ? 'Down' : 'Up'} ${Math.abs(d).toFixed(1)} points - ${d <= 0 ? 'better' : 'worse'}` : '-'],
    ],
  });

  const supRows = sups.map((s) => ({ s, t: sumDays(td.filter((r) => r.supId === s.id)) })).filter((x) => x.t.units > 0 || x.t.wage > 0).sort((a, b) => (a.t.pct || 999) - (b.t.pct || 999));
  h('By supervisor (best Labour % first)', doc.lastAutoTable.finalY + 10);
  autoTable(doc, { startY: doc.lastAutoTable.finalY + 13, theme: 'striped', headStyles: head, styles: { fontSize: 9.5 }, columnStyles: num3, didParseCell: rightHead, head: heads('Supervisor'), body: supRows.length ? supRows.map((x) => line(x.s.name, x.t)) : [['No data', '', '', '', '']] });

  const dates = [...new Set(td.map((r) => r.date))].sort();
  h('Day by day', doc.lastAutoTable.finalY + 10);
  autoTable(doc, { startY: doc.lastAutoTable.finalY + 13, theme: 'striped', headStyles: head, styles: { fontSize: 9.5 }, columnStyles: num3, didParseCell: rightHead, head: heads('Date'),
    body: dates.map((dt) => line(fmtDate(dt), sumDays(td.filter((r) => r.date === dt)))),
    foot: [line('TOTAL', tot)], footStyles: { fillColor: [243, 246, 251], textColor: 20, fontStyle: 'bold' }, showFoot: 'lastPage' });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(140);
    const H = doc.internal.pageSize.getHeight();
    doc.text(`Generated ${nowIST()} IST`, M, H - 8); doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}
