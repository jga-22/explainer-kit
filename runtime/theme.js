// Central style: style.json -> CSS variables + colour helpers for three.js.
import style from 'style-data';
import { Color } from 'three';

export const STYLE = style;
export const P = style.palette;
export const SC = style.scene;

export function applyTheme(root = document.documentElement) {
  for (const [k, v] of Object.entries(P)) root.style.setProperty(`--c-${k}`, v);
  for (const [k, v] of Object.entries(style.font))
    root.style.setProperty(`--f-${k}`, typeof v === 'number' ? `${v}px` : v);
}

/** Palette key or literal '#rrggbb' -> '#rrggbb'. */
export const hex = (k) => P[k] ?? k;
/** -> 0xRRGGBB number */
export const num = (k) => parseInt(hex(k).slice(1), 16);
/** -> THREE.Color (colour-managed) */
export const color = (k) => new Color(hex(k));
/** -> 'vec3(r,g,b)' for shader strings */
export const glsl = (k) => {
  const c = color(k);
  return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;
};
