// A gradient ASCII-font renderable built on @opentui/core's own font engine.
//
// <ascii-font>'s color array maps to font LAYERS (every font has at most two:
// letter face + drop shadow), so a true left-to-right gradient needs
// per-character coloring. This renderable draws each character of the text
// individually via renderFontToFrameBuffer, with its face color interpolated
// between two stops and its shadow a darkened version of the same step — the
// glyphs are identical to <ascii-font>'s, only the coloring differs.
//
// Props are construction-time only (no setters): the banner text never
// changes at runtime.

import {
  FrameBufferRenderable,
  measureText,
  getCharacterPositions,
  renderFontToFrameBuffer,
  type FrameBufferOptions,
  type RenderContext,
} from "@opentui/core";
import { extend } from "@opentui/react";

type FontName = Parameters<typeof getCharacterPositions>[1];

export interface GradientFontOptions
  extends Omit<FrameBufferOptions, "width" | "height"> {
  text?: string;
  font?: FontName;
  stops?: readonly [string, string];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")
  );
}

// lerpHex("#rrggbb", "#rrggbb", t) -> the color t of the way from `from` to `to`.
export function lerpHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
}

// darkenHex(hex, factor) -> the same hue scaled toward black (factor 0..1).
export function darkenHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

export class GradientFontRenderable extends FrameBufferRenderable {
  constructor(ctx: RenderContext, options: GradientFontOptions) {
    const text = options.text ?? "";
    const font: FontName = options.font ?? "block";
    const size = measureText({ text, font });
    super(ctx, {
      ...options,
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      respectAlpha: true,
    });

    const [from, to] = options.stops ?? ["#56c1f8", "#ff6ac1"];
    const positions = getCharacterPositions(text, font);
    const lastIndex = Math.max(1, text.length - 1);
    for (let i = 0; i < text.length; i++) {
      const face = lerpHex(from, to, i / lastIndex);
      renderFontToFrameBuffer(this.frameBuffer, {
        text: text[i],
        x: positions[i],
        y: 0,
        color: [face, darkenHex(face, 0.55)],
        backgroundColor: "transparent",
        font,
      });
    }
  }
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    gradientFont: typeof GradientFontRenderable;
  }
}

extend({ gradientFont: GradientFontRenderable });
