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

export async function convertRgbDataToDataUrl(
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
