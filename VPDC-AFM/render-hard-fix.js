/* Formats flattened source passages (e.g. ICAI economic-scenario tables) as a readable table
   inside the case-scenario card, without touching the underlying saved data. */
(function () {
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function formatPassages() {
    document.querySelectorAll('.vpdc-case-body').forEach(el => {
      if (el.dataset.formatted === '1') return;
      const raw = el.textContent.trim();
      if (!raw) return;
      const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
      const economy = lines.indexOf('Economy');
      const boom = lines.indexOf('Boom');
      const tail = lines.findIndex((s, i) => i > boom && /^The risk-free rate|^The total numbers|^From the information/i.test(s));
      if (economy >= 0 && boom > economy) {
        const intro = lines.slice(0, economy).join(' ');
        const heads = ['Economy', 'Probability', 'Return on Stock A (%)', 'Return on Stock B (%)', 'Market Portfolio (%)'];
        const body = lines.slice(boom, tail > boom ? tail : lines.length);
        const rows = [];
        for (let i = 0; i < body.length; i += 2) {
          if (/^(Boom|Normal|Recession)$/i.test(body[i])) rows.push([body[i], body[i + 1] || '\u2014', '\u2014', '\u2014', '\u2014']);
        }
        const after = (tail > boom ? lines.slice(tail) : []).join(' ');
        el.innerHTML = `<p class="scenario-intro">${esc(intro)}</p><div class="scenario-table-wrap"><table class="scenario-table"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${after ? `<p class="scenario-after">${esc(after)}</p>` : ''}`;
      } else {
        el.textContent = raw;
      }
      el.dataset.formatted = '1';
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    .vpdc-case-body{max-height:min(48vh,520px);overflow:auto;overflow-wrap:anywhere;word-break:normal}
    .scenario-table-wrap{width:100%;overflow-x:auto;margin:14px 0;border:1px solid rgba(126,163,202,.28);border-radius:10px}
    .scenario-table{width:100%;min-width:640px;border-collapse:collapse;font-size:13px}
    .scenario-table th,.scenario-table td{padding:10px 12px;border-bottom:1px solid rgba(126,163,202,.18);text-align:left;vertical-align:top}
    .scenario-table th{white-space:normal;background:rgba(34,53,78,.55)}
    .scenario-intro,.scenario-after{margin:0 0 12px}
    @media(max-width:900px){.vpdc-case-body{max-height:none}.scenario-table{font-size:12px}.scenario-table th,.scenario-table td{padding:9px}}
  `;
  document.head.appendChild(style);
  const run = () => formatPassages();
  run();
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
