/**
 * The interface's cardstock (the papercraft skill's paperSheet, paper-ui.md section 3): one seamless tile of the page
 * colour with soft blotches, fine fibres and specks, drawn once at start-up and set as the CSS --paper the panels lay
 * over their page colour (ui/paper.css).
 */
import './paper.css';

const SIZE = 384;
const PAGE = '#efe0c2';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws the tile and installs it as --paper (each mark drawn at its wrapped copies too, so the tile is seamless). */
export function installPaper(seed = 7): void {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const u = SIZE / 100;
  g.fillStyle = PAGE;
  g.fillRect(0, 0, SIZE, SIZE);
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) draw(dx, dy);
  };
  // soft blotches, light and dark
  for (let i = 0; i < 60; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const rad = (8 + r() * 22) * u;
    const colour = r() < 0.5 ? 'rgba(251,246,234,0.16)' : 'rgba(205,180,134,0.13)';
    wrapped((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, colour);
      gr.addColorStop(1, 'rgba(205,180,134,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  // fibres: short bent strokes, most of them light
  const fibres = Math.round((SIZE * SIZE) / 520);
  g.lineCap = 'round';
  for (let i = 0; i < fibres; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const len = (0.5 + r() * 1.7) * u;
    const a = r() * Math.PI * 2;
    const bend = (r() - 0.5) * 0.6 * len;
    const light = r() < 0.55;
    const colour = light ? `rgba(253,249,240,${(0.2 + r() * 0.3).toFixed(3)})` : `rgba(176,146,100,${(0.1 + r() * 0.16).toFixed(3)})`;
    const w = (0.05 + r() * 0.09) * u;
    const ex = Math.cos(a) * len;
    const ey = Math.sin(a) * len;
    wrapped((dx, dy) => {
      g.strokeStyle = colour;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(x + dx + ex / 2 - ey * (bend / len), y + dy + ey / 2 + ex * (bend / len), x + dx + ex, y + dy + ey);
      g.stroke();
    });
  }
  // specks
  for (let i = 0; i < fibres / 3; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    g.fillStyle = `rgba(120,88,56,${(0.05 + r() * 0.12).toFixed(3)})`;
    g.fillRect(x, y, 0.1 * u + 0.6, 0.1 * u + 0.6);
  }
  document.documentElement.style.setProperty('--paper', `url(${c.toDataURL()})`);
}

