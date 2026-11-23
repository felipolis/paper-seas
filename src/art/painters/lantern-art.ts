/** The stern lantern card, drawn in code: a lit glass body with a gilt cross, a dark cap. */
import { PALETTE } from '../../config/palette';
import { CardPainter, polygonPath, smoothOpenPath, type CardArt } from '../card-painter';

let art: CardArt | null = null;

export function lanternArt(): CardArt {
  if (!art) {
    const painter = new CardPainter({ left: -0.06, right: 0.06, bottom: 0, top: 0.2 }, { ppu: 500, pad: 0.015 });
    const ctx = painter.ctx;
    const body = polygonPath([[-0.045, 0.02], [-0.055, 0.12], [-0.03, 0.17], [0.03, 0.17], [0.055, 0.12], [0.045, 0.02]]);
    const cap = polygonPath([[-0.035, 0.165], [0, 0.2], [0.035, 0.165]]);
    painter.fill(body, PALETTE.lantern);
    painter.clipped(body, () => {
      ctx.strokeStyle = PALETTE.goldDark;
      ctx.lineWidth = 0.008;
      ctx.stroke(smoothOpenPath([[0, 0.02], [0, 0.17]]));
      ctx.stroke(smoothOpenPath([[-0.06, 0.09], [0.06, 0.09]]));
    });
    painter.fill(cap, PALETTE.hullDark);
    const outline = new Path2D();
    outline.addPath(body);
    outline.addPath(cap);
    art = painter.finish(outline, { ink: 0.008, grain: 0 });
  }
  return art;
}
