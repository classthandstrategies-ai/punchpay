/**
 * Synthetic evidence for the offline simulation. These are drawings, not photographs, and each one
 * says so on the image itself. The fixture reports in scenarios.ts describe exactly what is drawn here.
 */
const W = 800, H = 600;
const stamp = `<g font-family="ui-monospace, Menlo, monospace" font-size="15" letter-spacing="1.5"><rect x="${W - 392}" y="${H - 40}" width="376" height="26" fill="#1c2621" opacity=".82"/><text x="${W - 380}" y="${H - 22}" fill="#fbfaf6" textLength="352" lengthAdjust="spacingAndGlyphs">SYNTHETIC ILLUSTRATION · NOT A PHOTO</text></g>`;
const svg = (body: string, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}</defs>${body}${stamp}</svg>`;
const uri = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

const light = `<linearGradient id="light" x1="0" x2="1"><stop offset="0" stop-color="#fffdf6" stop-opacity=".55"/><stop offset=".55" stop-color="#fffdf6" stop-opacity="0"/></linearGradient>`;
function wall(scuff: boolean) {
  return `<rect width="${W}" height="${H}" fill="#d8d3c3"/>
  <rect x="40" y="70" width="250" height="360" fill="#f3f1ea"/><rect x="58" y="88" width="214" height="324" fill="#dfe6e1"/>
  <line x1="165" y1="88" x2="165" y2="412" stroke="#f3f1ea" stroke-width="10"/><line x1="58" y1="250" x2="272" y2="250" stroke="#f3f1ea" stroke-width="10"/>
  <rect x="30" y="430" width="270" height="16" fill="#ece9e0"/>
  <rect x="0" y="520" width="${W}" height="80" fill="#efece4"/><rect x="0" y="516" width="${W}" height="6" fill="#c9c3b3"/>
  <rect width="${W}" height="520" fill="url(#light)"/>
  ${scuff ? `<g opacity=".78"><path d="M352 300 q24 -18 62 -8 q30 8 44 -6 q10 18 -16 30 q-34 16 -70 6 q-22 -6 -20 -22z" fill="#8f8a7d"/><path d="M370 296 l70 -6 M362 312 l84 -4 M380 322 l40 2" stroke="#6f6a5f" stroke-width="2.5" stroke-linecap="round"/></g>
  <circle cx="405" cy="305" r="74" fill="none" stroke="#8d4f33" stroke-width="3" stroke-dasharray="10 8"/>` : ""}`;
}

function tiles(after: boolean) {
  const cols = 4, rows = 4, tw = 176, th = 88, g = 8, x0 = 34, y0 = 40;
  let out = `<rect width="${W}" height="${H}" fill="#cfc9bc"/>`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + c * (tw + g), y = y0 + r * (th + g);
    const target = r === 2 && c === 1;
    if (target && after) {
      out += `<g transform="rotate(1.6 ${x + tw / 2} ${y + th / 2}) translate(0 7)"><rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="3" fill="#f7f6f1"/><rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="3" fill="none" stroke="#e2dfd5" stroke-width="2"/></g>
      <rect x="${x + tw + 1}" y="${y}" width="9" height="${th + 8}" fill="#8a8476"/>`;
    } else {
      out += `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="3" fill="#f5f3ec"/><rect x="${x}" y="${y}" width="${tw}" height="18" rx="3" fill="#ffffff" opacity=".5"/>`;
      if (target && !after) out += `<path d="M${x + 28} ${y + 6} l22 24 l-8 14 l30 22 l6 20" fill="none" stroke="#5a554b" stroke-width="3" stroke-linejoin="round"/><circle cx="${x + tw / 2}" cy="${y + th / 2}" r="72" fill="none" stroke="#8d4f33" stroke-width="3" stroke-dasharray="10 8"/>`;
    }
  }
  out += `<rect x="0" y="430" width="${W}" height="170" fill="#b9bdb9"/><rect x="0" y="430" width="${W}" height="10" fill="#9ea39f"/><ellipse cx="560" cy="520" rx="170" ry="40" fill="#a7aca8"/>`;
  return out;
}

export const ILLUSTRATIONS = {
  "paint-before": uri(svg(wall(true), light)),
  "paint-after": uri(svg(wall(false), light)),
  // Same wall, photographed from far left at a steep angle, in low light, partly cropped.
  "paint-after-oblique": uri(svg(`<g transform="translate(420 -40) scale(1.25 1.1) skewY(18)">${wall(false)}</g><rect width="${W}" height="${H}" fill="#1c2621" opacity=".42"/><rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)"/>`, `${light}<radialGradient id="vig"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>`)),
  "tile-before": uri(svg(tiles(false))),
  "tile-after": uri(svg(tiles(true)))
} as const;
export type IllustrationKey = keyof typeof ILLUSTRATIONS;
