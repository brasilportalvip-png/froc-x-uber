/** Recibo para imprimir ou salvar em PDF (pelo "Imprimir → Salvar como PDF" do navegador). */
export function openReceipt(data: {
  title: string;
  id: string;
  date: string;
  from: string;
  to: string;
  provider?: string;
  vehicle?: string;
  distanceKm?: number;
  amount: number;
  paymentMethod: string;
  customer: string;
}) {
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (v: unknown) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  const rows: [string, string][] = [
    ['Cliente', data.customer],
    ['Data', data.date],
    ['Origem', data.from],
    ['Destino', data.to],
    ...(data.provider ? ([['Prestador', data.provider]] as [string, string][]) : []),
    ...(data.vehicle ? ([['Veículo', data.vehicle]] as [string, string][]) : []),
    ...(data.distanceKm ? ([['Distância', `${data.distanceKm} km`]] as [string, string][]) : []),
    ['Pagamento', data.paymentMethod],
    ['Código', data.id],
  ];
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo Froc X Uber</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#0f172a}
h1{font-size:22px;margin:0}small{color:#64748b}table{width:100%;border-collapse:collapse;margin:20px 0}
td{padding:8px 0;border-bottom:1px solid #e2e8f0}td:first-child{color:#64748b;width:38%}
.total{font-size:24px;font-weight:800;color:#059669}button{margin-top:16px;padding:10px 16px;font:inherit}
@media print{button{display:none}}</style></head><body>
<h1>Froc X Uber</h1><small>Recibo de ${esc(data.title)}</small>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<div>Total pago</div><div class="total">${esc(brl(data.amount))}</div>
<p><small>Este recibo comprova o pagamento intermediado pela plataforma. Não substitui nota fiscal.</small></p>
<button onclick="print()">Imprimir / salvar em PDF</button></body></html>`;
  const w = window.open('', '_blank', 'width=640,height=800');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
