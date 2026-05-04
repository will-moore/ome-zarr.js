import * as zarr from "zarrita";
import { slice } from "zarrita";
import { Multiscale, Omero } from "./types/ome";
import { getLutRgb } from "./luts";
import { NgffImage } from "./image";


export const MAX_CHANNELS = 3;
export const COLORS = {
  cyan: "#00FFFF",
  yellow: "#FFFF00",
  magenta: "#FF00FF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  white: "#FFFFFF",
};
export const MAGENTA_GREEN = [COLORS.magenta, COLORS.green];
export const RGB = [COLORS.red, COLORS.green, COLORS.blue];
export const CYMRGB = Object.values(COLORS);

// this duplicates Slice() from zarrita as I couldn't import it
export interface Slice {
  start: number | null;
  stop: number | null;
  step: number | null;
}

export function hexToRGB(hex: string): [number, number, number] {
  if (hex.startsWith("#")) hex = hex.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}

export function getDefaultVisibilities(n: number): boolean[] {
  let visibilities: boolean[];
  if (n <= MAX_CHANNELS) {
    // Default to all on if visibilities not specified and less than 6 channels.
    visibilities = Array(n).fill(true);
  } else {
    // If more than MAX_CHANNELS, only make first set on by default.
    visibilities = [
      ...Array(MAX_CHANNELS).fill(true),
      ...Array(n - MAX_CHANNELS).fill(false),
    ];
  }
  return visibilities;
}

export function createOmero(
  {sizeC, sizeZ, sizeT}: {sizeC: number, sizeZ?: number, sizeT?: number},
  dtype: string
): Omero {
  let visibilities = getDefaultVisibilities(sizeC);
  let colors = getDefaultColors(sizeC, visibilities);
  let minMax = getPixelValueRange(dtype);
  let channels = visibilities.map((active, i) => ({
    active,
    color: colors[i],
    window: { min: minMax.min, max: minMax.max },
  }));
  let rdefs = {
    defaultT: sizeT !== undefined ? Math.floor(sizeT / 2) : 0,
    defaultZ: sizeZ !== undefined ? Math.floor(sizeZ / 2) : 0,
    model: "color",
  };
  return { channels, rdefs } as Omero;
}

export function getDefaultColors(
  n: number,
  visibilities: boolean[]
): string[] {
  let colors: string[] = [];
  if (n == 1) {
    colors = [COLORS.white];
  } else if (n == 2) {
    colors = MAGENTA_GREEN;
  } else if (n === 3) {
    colors = RGB;
  } else if (n <= MAX_CHANNELS) {
    colors = CYMRGB.slice(0, n);
  } else {
    // Default color for non-visible is white
    colors = Array(n).fill(COLORS.white);
    // Get visible indices
    const visibleIndices = visibilities.flatMap((bool, i) => (bool ? i : []));
    // Set visible indices to CYMRGB colors. visibleIndices.length === MAX_CHANNELS from above.
    for (const [i, visibleIndex] of visibleIndices.entries()) {
      colors[visibleIndex] = CYMRGB[i];
    }
  }
  colors = colors.map(color => {
    if (color.startsWith("#")) color = color.slice(1);
    return color;
  });
  return colors;
}

export function getDefaultRgbColors(
  n: number,
  visibilities: boolean[]
): [number, number, number][] {
  let colors = getDefaultColors(n, visibilities);
  return colors.map(hexToRGB);
}

export function getMinMaxValues(chunk2d: any): [number, number] {
  const data = chunk2d.data;
  let maxV = 0;
  let minV = Infinity;
  let length = chunk2d.data.length;
  for (let y = 0; y < length; y++) {
    // In case of bigint, convert to number. See #9
    let rawValue = Number(data[y]);
    maxV = Math.max(maxV, rawValue);
    minV = Math.min(minV, rawValue);
  }
  return [minV, maxV];
}

export function getPixelValueRange(dtype: string): { min: number; max: number } {
  // Code migrated from Fileglancer
  // Default values
  let dtypeMin = 0;
  let dtypeMax = 65535;

  if (dtype) {
    // const dtype;
    // Parse numpy-style dtype strings (int8, int16, uint8, etc.)
    if (dtype.includes('int') || dtype.includes('uint')) {
      // Extract the numeric part for bit depth
      const bitMatch = dtype.match(/\d+/);
      if (bitMatch) {
        const bitCount = parseInt(bitMatch[0]);
        if (dtype.startsWith('u')) {
          // Unsigned integer (uint8, uint16, etc.)
          dtypeMin = 0;
          dtypeMax = 2 ** bitCount - 1;
        } else {
          // Signed integer (int8, int16, etc.)
          dtypeMin = -(2 ** (bitCount - 1));
          dtypeMax = 2 ** (bitCount - 1) - 1;
        }
      } else {
        // Try explicit endianness format: <byteorder><type><bytes>
        const oldFormatMatch = dtype.match(/^[<>|]([iuf])(\d+)$/);
        if (oldFormatMatch) {
          const typeCode = oldFormatMatch[1];
          const bytes = parseInt(oldFormatMatch[2], 10);
          const bitCount = bytes * 8;
          if (typeCode === 'i') {
            // Signed integer
            dtypeMin = -(2 ** (bitCount - 1));
            dtypeMax = 2 ** (bitCount - 1) - 1;
          } else if (typeCode === 'u') {
            // Unsigned integer
            dtypeMin = 0;
            dtypeMax = 2 ** bitCount - 1;
          }
        } else {
          console.warn('Could not determine min/max values for dtype: ', dtype);
        }
      }
    } else {
      console.warn('Unrecognized dtype format: ', dtype);
    }
  }
  return { min: dtypeMin, max: dtypeMax };
}

export function range(start: number, end: number): number[] {
  // range(5, 10) -> [5, 6, 7, 8, 9]
  return Array.from({ length: end - start }, (_, i) => i + start);
}

export function renderTo8bitArray(
  ndChunks: any,
  minMaxValues: Array<[number, number]>,
  colors: Array<[number, number, number]>,
  luts: Array<string | undefined> | undefined,
  inverteds: Array<boolean> | undefined,
  autoBoost: boolean = false
): Uint8ClampedArray {
  // Render chunks (array) into 2D 8-bit data for new ImageData(arr)
  // if autoBoost is true, check histogram and boost contrast if needed
  // ndChunks is list of zarr arrays

  // assume all chunks are same shape
  const shape = ndChunks[0].shape;
  const height = shape[0];
  const width = shape[1];
  const pixels = height * width;

  if (!minMaxValues) {
    minMaxValues = ndChunks.map(getMinMaxValues);
  }

  // load luts if needed
  const lutRgbs = luts?.map((lut) => lut && getLutRgb(lut as string));

  // let rgb = [255, 255, 255];
  let start = performance.now();

  let rgba = new Uint8ClampedArray(4 * height * width).fill(0);
  let offset = 0;
  for (let p = 0; p < ndChunks.length; p++) {
    offset = 0;
    let rgb = colors[p];
    let lutRgb = lutRgbs?.[p];
    let data = ndChunks[p].data;
    let range = minMaxValues[p];
    let inverted = inverteds?.[p];
    for (let y = 0; y < pixels; y++) {
      // In case of bigint, convert to number. See #9
      let rawValue = Number(data[y]);
      let fraction = (rawValue - range[0]) / (range[1] - range[0]);
      fraction = Math.min(1, Math.max(0, fraction));
      // for red, green, blue,
      for (let i = 0; i < 3; i++) {
        // rgb[i] is 0-255...
        let v;
        if (lutRgb) {
          let val = Math.round(fraction * 255);
          v = lutRgb[val][i];
          if (inverted) {
            v = 255 - v;
          }
        } else {
          v = Math.round(fraction * rgb[i]);
          // invert. If channel is 'red' only, don't invert green & blue!
          if (inverted && rgb[i] != 0) {
            v = 255 - v;
          }
        }
        // add values together for each channel, with max at 255
        rgba[offset * 4 + i] = Math.min(rgba[offset * 4 + i] + v, 255);
      }
      rgba[offset * 4 + 3] = 255; // alpha
      offset += 1;
    }
  }
  // if iterating pixels is fast, check histogram and boost contrast if needed
  // Thumbnails are less than 5 millisecs. 512x512 is 10-20 millisecs.
  if (performance.now() - start < 100 && autoBoost) {
    let bins = 5;
    let hist = getHistogram(rgba, bins);
    // If top bin, has less than 1% of pixesl, boost contrast
    if (hist[bins - 1] < 1) {
      let factor = 2;
      rgba = boostContrast(rgba, factor);
    }
  }
  return rgba;
}

function boostContrast(
  rgba: Uint8ClampedArray,
  factor: number
): Uint8ClampedArray {
  // Increase contrast by factor
  for (let pixel = 0; pixel < rgba.length / 4; pixel++) {
    for (let i = 0; i < 3; i++) {
      let v = rgba[pixel * 4 + i];
      v = Math.min(255, v * factor);
      rgba[pixel * 4 + i] = v;
    }
  }
  return rgba;
}

function getHistogram(uint8array: Uint8ClampedArray, bins = 5): number[] {
  // Create histogram from uint8array.
  // Returns list of percentages in each bin
  let hist = new Array(bins).fill(0);
  const binSize = 256 / bins;
  let pixelCount = uint8array.length / 4;
  for (let i = 0; i < pixelCount; i++) {
    // get max of r,g,b
    let maxV = uint8array[i * 4];
    maxV = Math.max(uint8array[i * 4 + 1], maxV);
    maxV = Math.max(uint8array[i * 4 + 2], maxV);
    let bin = Math.floor(maxV / binSize);
    hist[bin] += 1;
  }
  // Normalize to percentage
  hist = hist.map((v) => (100 * v) / pixelCount);
  return hist;
}

// For backwards compatibility - keep this function
export async function getMultiscale(
  group: zarr.Group<zarr.Readable> | zarr.Readable | string,
  options?: { signal?: AbortSignal }
): Promise<{
  multiscale: Multiscale;
  omero: Omero | null | undefined;
  zarr_version: 2 | 3;
}> {
  const img = await NgffImage.load(group, options);
  return {
    multiscale: img.multiscales[0],
    omero: img.omero,
    zarr_version: img.zarr_version,
  };
}

export async function getMultiscaleWithArray(
  group: zarr.Group<zarr.Readable> | zarr.Readable | string,
  datasetIndex: number = 0,
  options?: { signal?: AbortSignal }
): Promise<{
  arr: zarr.Array<any>;
  shapes: number[][] | undefined;
  multiscale: Multiscale;
  omero: Omero | null | undefined;
  scales: number[][];
  zarr_version: 2 | 3;
}> {
  const img = await NgffImage.load(group, options);
  const multiscale = img.multiscales[0];
  const omero = img.omero;
  const zarr_version = img.zarr_version;
  const scales = img.scales;

  // Get the specified zarr array
  const arr = await img.openArray(datasetIndex, options);
  // This uses the cached array to calculate shapes from scales
  let shapes: number[][] | undefined = await img.calcShapes();
  if (shapes.length == 0) {
    shapes = undefined;
  }
  return { arr, shapes, multiscale, omero, scales, zarr_version };
}

export async function openArrayOrGroup(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  kind: "array",
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Array<zarr.DataType>>;
export async function openArrayOrGroup(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  kind: "group",
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Group<zarr.Readable>>;
export async function openArrayOrGroup(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  kind: "array" | "group",
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Array<zarr.DataType> | zarr.Group<zarr.Readable>> {
  const { signal } = options ?? {};
  signal?.throwIfAborted();
  const openFn =
    zarr_version === 3
      ? zarr.open.v3
      : zarr_version === 2
        ? zarr.open.v2
        : zarr.open;

  let location;
  if (src instanceof zarr.Group) {
    location = src;
  } else {
    const store = typeof src === "string" ? new zarr.FetchStore(src) : src;
    location = zarr.root(store);
  }
  if (path) {
    location = location.resolve(path);
  }
  const arrayOrGroup = await openFn(location, { kind });  // TODO https://github.com/manzt/zarrita.js/issues/317
  signal?.throwIfAborted();
  return arrayOrGroup;
}

// For backwards compatibility - keep this function
export async function getArray(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Array<zarr.DataType>> {
  // deprecation warning
  console.warn(
    "getArray is deprecated and will be removed in future versions. Please use openArray() instead."
  );
  const { signal } = options ?? {};
  return openArray(src, path, zarr_version, { signal});
}

export async function openArray(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Array<zarr.DataType>> {
  const { signal } = options ?? {};
  signal?.throwIfAborted();
  return openArrayOrGroup(src, "array", path, zarr_version, { signal });
}

export async function openGroup(
  src: zarr.Group<zarr.Readable> | zarr.Readable | string,
  path?: string,
  zarr_version?: 2 | 3,
  options?: { signal?: AbortSignal }
): Promise<zarr.Group<zarr.Readable>> {
  const { signal } = options ?? {};
  signal?.throwIfAborted();
  return openArrayOrGroup(src, "group", path, zarr_version, { signal });
}

export function getSlices(
  activeChannelIndices: number[],
  shape: number[],
  axesNames: string[],
  indices: { [k: string]: number | [number, number] | undefined },
  originalShape?: number[]
): (number | Slice | undefined)[][] {
  // Slice indices are with respect to originalShape if provided
  // For each active channel, get a multi-dimensional slice
  let chSlices = activeChannelIndices.map((chIndex: number) => {
    let chSlice = shape.map((dimSize, index) => {
      let origDimSize = originalShape ? originalShape[index] : dimSize;
      let name = axesNames[index];
      // channel
      if (name == "c") return chIndex;

      if (name in indices) {
        let idx = indices[name];
        if (Array.isArray(idx)) {
          return slice(
            Math.floor((idx[0] / origDimSize) * dimSize),
            Math.floor((idx[1] / origDimSize) * dimSize)
          );
        } else if (Number.isInteger(idx)) {
          // scale index if needed. e.g. Z-size of arr shape is 10, but originalShape is 50,
          // and idx is 25, we want to get slice 5 from this array
          return idx !== undefined
            ? Math.floor((idx / origDimSize) * dimSize)
            : undefined;
        }
      }
      // no valid indices supplied, use defaults...
      // x and y - we want full range
      if (name == "x" || name == "y") {
        return slice(0, dimSize);
      }
      // Use omero for z/t if available, otherwise use middle slice
      if (name == "z" || name == "t") {
        return parseInt(dimSize / 2 + "");
      }
      return 0;
    });
    return chSlice;
  });
  return chSlices;
}
