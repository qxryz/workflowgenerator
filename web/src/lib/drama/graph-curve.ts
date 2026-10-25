export type Point = { x: number; y: number };
export type Curve = { p0: Point; c: Point; p1: Point };

export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const bezier = ({ p0, c, p1 }: Curve, t: number) => lerp(lerp(p0, c, t), lerp(c, p1, t), t);
export const tangent = ({ p0, c, p1 }: Curve, t: number): Point => {
    const x = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
        y = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y);
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
};
export const fmt = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

/** The part of a curve between parameters a and b (de Casteljau). */
export function slice(curve: Curve, a: number, b: number): Curve {
    const start = bezier(curve, a);
    const right = lerp(curve.c, curve.p1, a);
    return { p0: start, c: lerp(start, right, (b - a) / (1 - a)), p1: bezier(curve, b) };
}
