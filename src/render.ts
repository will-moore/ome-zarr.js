import * as zarr from "zarrita";

import { Axis, Omero } from "./types/ome";
import {
  getDefaultVisibilities,
  hexToRGB,
  getDefaultRgbColors,
  getMinMaxValues,
  getSlices,
  renderTo8bitArray,
  MAX_CHANNELS,
} from "./utils";

export type Color = [number, number, number] | [number, number, number, number];
export type Blending = "additive" | "translucent";

export function renderChannel(
  chunk: zarr.Chunk<zarr.NumberDataType | zarr.BigintDataType>,
  func: (value: number) => Color,
  options?: { target?: Uint8ClampedArray; blending?: Blending }
): Uint8ClampedArray {
  const { target, blending = "additive" } = options ?? {};

  const [height, width] = chunk.shape;
  const data = target ?? new Uint8ClampedArray(4 * height * width).fill(0);
  const n = height * width;
  for (let i = 0; i < n; i++) {
    const value = Number(chunk.data[i]!);
    const [r, g, b, alpha = 255] = func(value);
    const alphaSrc = data[4 * i + 3] / 255;
    const alphaDst = (alpha ?? 255) / 255;
    if (blending === "additive") {
      // Additive blending
      data[4 * i] = Math.min(data[4 * i] * alphaSrc + r, 255);
      data[4 * i + 1] = Math.min(data[4 * i + 1] * alphaSrc + g, 255);
      data[4 * i + 2] = Math.min(data[4 * i + 2] * alphaSrc + b, 255);
      data[4 * i + 3] = Math.min(alphaSrc + alphaDst, 1.0) * 255;
    } else if (blending === "translucent") {
      // A over B (Porter & Duff, 1984)
      // https://en.wikipedia.org/wiki/Alpha_compositing
      data[4 * i] = r * alphaDst + data[4 * i] * alphaSrc * (1 - alphaDst);
      data[4 * i + 1] =
        g * alphaDst + data[4 * i + 1] * alphaSrc * (1 - alphaDst);
      data[4 * i + 2] =
        b * alphaDst + data[4 * i + 2] * alphaSrc * (1 - alphaDst);
      data[4 * i + 3] = (alphaDst + alphaSrc * (1 - alphaDst)) * 255;
    } else {
      throw new Error("Invalid blending mode");
    }
  }
  return data;
}

export function renderChannelWithLUT(
  chunk: zarr.Chunk<zarr.NumberDataType | zarr.BigintDataType>,
  lut: Color[],
  options?: {
    target?: Uint8ClampedArray;
    blending?: Blending;
    range?: [number, number];
  }
): Uint8ClampedArray {
  if (lut.length !== 256) {
    throw new Error("LUT must have 256 entries");
  }
  const { target, blending = "additive", range = [0, 255] } = options ?? {};

  function func(value: number): Color {
    const [min, max] = range;
    if (value < min) value = min;
    if (value > max) value = max;
    value = Math.round((255 * (value - min)) / (max - min));
    return lut[value];
  }

  return renderChannel(chunk, func, { target, blending });
}

export function renderChannelWithColormap(
  chunk: zarr.Chunk<zarr.NumberDataType | zarr.BigintDataType>,
  colormap: Map<number, Color>,
  options?: {
    target?: Uint8ClampedArray;
    blending?: Blending;
    fillValue?: Color;
  }
): Uint8ClampedArray {
  const {
    target,
    blending = "additive",
    fillValue = [0, 0, 0, 0],
  } = options ?? {};

  function func(value: number): Color {
    return colormap.get(value) ?? fillValue;
  }

  return renderChannel(chunk, func, { target, blending });
}

export async function getRgba(
  arr: zarr.Array<any, zarr.Readable>,
  axes: Axis[],
  omero: Omero | null | undefined,
  sliceIndices: { [k: string]: number | [number, number] | undefined },
  originalShape: number[] | undefined,
  autoBoost: boolean,
  options?: { signal?: AbortSignal }
): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const { signal } = options ?? {};
  signal?.throwIfAborted();

  let shape = arr.shape;

  // NB: v0.2 no axes. v0.3 is just list of 'x', 'y', 'z', 'c', 't'
  // v0.4 onwards is list of Axis objects
  let axesNames = axes?.map((a) => a.name || a.toString()) || [
    "t",
    "c",
    "z",
    "y",
    "x",
  ];
  let chDim = axesNames.indexOf("c");
  let channel_count = shape[chDim] || 1;
  let visibilities;
  // list of [r,g,b] colors
  let rgbColors: Array<[number, number, number]>;
  let luts: (string | undefined)[] = [];
  let inverteds: Array<boolean> | undefined = undefined;

  // If we have 'omero', use it for channel rgbColors and visibilities
  if (omero) {
    let active_count = 0;
    visibilities = omero.channels.map((ch) => {
      if (ch.active == undefined) {
        ch.active = true;
      }
      active_count += ch.active ? 1 : 0;
      return ch.active && active_count <= MAX_CHANNELS;
    });
    rgbColors = omero.channels.map((ch) => hexToRGB(ch.color));
    luts = omero.channels.map((ch) =>
      "lut" in ch ? (ch.lut as string) : undefined
    );
  } else {
    visibilities = getDefaultVisibilities(channel_count);
    rgbColors = getDefaultRgbColors(channel_count, visibilities);
  }
  // filter for active channels
  let activeChannelIndices: number[] = visibilities.reduce(
    (prev: number[], active, index) => {
      if (active) prev.push(index);
      return prev;
    },
    []
  );
  rgbColors = activeChannelIndices.map((chIndex: number) => rgbColors[chIndex]);
  inverteds = activeChannelIndices.map((chIndex: number) =>
    Boolean(omero?.channels[chIndex].inverted)
  );
  if (luts !== undefined) {
    luts = luts.filter((_, index) => activeChannelIndices.includes(index));
  }

  // Get slices for each channel
  if (sliceIndices["z"] == undefined) {
    sliceIndices["z"] = omero?.rdefs?.defaultZ;
  }
  if (sliceIndices["t"] == undefined) {
    sliceIndices["t"] = omero?.rdefs?.defaultT;
  }
  // sliceIndices are from originalShape if provided
  let chSlices = getSlices(
    activeChannelIndices,
    shape,
    axesNames,
    sliceIndices,
    originalShape
  );

  // Wait for all chunks to be fetched...
  let promises = chSlices.map((chSlice: any) =>
    zarr.get(arr, chSlice, { opts: { signal } })
  );
  let ndChunks = await Promise.all(promises);
  signal?.throwIfAborted();

  // Use start/end values from 'omero' if available, otherwise calculate min/max
  let minMaxValues = activeChannelIndices.map(
    (chIndex: number, i: number): [number, number] => {
      if (omero && omero.channels[chIndex]) {
        let chOmero = omero.channels[chIndex];
        if (
          chOmero?.window?.start !== undefined &&
          chOmero?.window?.end !== undefined
        ) {
          return [chOmero.window.start, chOmero.window.end];
        }
      }
      return getMinMaxValues(ndChunks[i]);
    }
  );

  // Render to 8bit rgb array
  let data = renderTo8bitArray(
    ndChunks,
    minMaxValues,
    rgbColors,
    luts,
    inverteds,
    autoBoost
  );

  const height = ndChunks[0].shape[0];
  const width = ndChunks[0].shape[1];
  return { data, width, height };
}

export async function convertRbgDataToDataUrl(
  rbgData: Uint8ClampedArray,
  width: number
): Promise<string> {
  let h = rbgData.length / (width * 4);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.putImageData(new ImageData(rbgData, width, h), 0, 0);
    return canvas.toDataURL("image/png");
  } else {
    const { PNG } = await import("pngjs");
    const { Buffer } = await import("buffer");
    const png = new PNG({ width, height: h });
    png.data = Buffer.from(
      rbgData.buffer,
      rbgData.byteOffset,
      rbgData.byteLength
    );
    const chunks: Buffer[] = [];
    const stream = png.pack();
    return new Promise((resolve, reject) => {
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        resolve(
          `data:image/png;base64,${Buffer.concat(chunks).toString("base64")}`
        );
      });
      stream.on("error", reject);
    });
  }
}
