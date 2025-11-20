
import * as zarr from "zarrita";

import { Axis, Omero, Channel } from "./types/ome";
import {
  getDefaultVisibilities,
  hexToRGB,
  getArray,
  getDefaultColors,
  getMinMaxValues,
  getMultiscaleWithArray,
  getSlices,
  renderTo8bitArray,
  MAX_CHANNELS,
} from "./utils";


export async function renderThumbnail(
  store: zarr.FetchStore | string,
  targetSize: number | undefined = undefined,
  autoBoost: boolean = false,
  maxSize: number = 1000,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (typeof store === "string") {
    store = new zarr.FetchStore(store);
  }

  // Lets load SMALLEST resolution and render it as a thumbnail
  const datasetIndex = -1;
  let { multiscale, omero, zarr_version, arr, shapes } = await getMultiscaleWithArray(store, datasetIndex, { signal });
  signal?.throwIfAborted();

  // targetSize is specified, may need to load a different resolution...
  // pick a different dataset level if we want a different size
  let shape = arr.shape;
  let dims = shape.length;
  let width = shape[dims - 1];
  let height = shape[dims - 2];
  if (height * width > maxSize * maxSize) {
    throw new Error(`Lowest resolution (${width} * ${height}) is too large for Thumbnail. Limit is ${maxSize} * ${maxSize}`);
  }

  let longestSide = Math.max(width, height);
  if (targetSize !== undefined && targetSize > longestSide) {
    let longestSizes: number[] = [];
    // If we don't have shapes (v0.1, 0.2, 0.3), we "guess" scale of * 2 for each level
    if (shapes == undefined) {
      longestSizes = multiscale.datasets.map((d, i) => d && longestSide * 2 ** i);
      longestSizes.reverse();
      // e.g. [1568, 784, 392, 196, 98, 49]
    } else {
      longestSizes = shapes.map((shape) => Math.max(shape[dims - 1], shape[dims - 2]));
    }
    const paths: Array<string> = multiscale.datasets.map((d) => d.path);

    let pathIndex;
    for (pathIndex = 0; pathIndex < longestSizes.length; pathIndex++) {
      let size = longestSizes[pathIndex];
      let nextSize = longestSizes[pathIndex + 1];
      if (!nextSize) {
        // we have reached smallest
        break;
      } else if (nextSize > targetSize) {
        // go smaller
        continue;
      } else {
        // is targetSize closer to this or next?
        let avg = (size + nextSize) / 2;
        if (targetSize < avg) {
          pathIndex += 1;
        }
        break;
      }
    }
    let path = paths[pathIndex];
    arr = await getArray(store, path, zarr_version, { signal });
    signal?.throwIfAborted();
  }

  // we want to remove any start/end values from window, to calculate min/max
  if (omero && "channels" in omero) {
    omero.channels = omero.channels.map((ch: Channel) => {
      if (ch.window) {
        ch.window.start = undefined;
        ch.window.end = undefined;
      }
      return ch;
    });
  }

  const originalShape = shapes?.[0];

  return renderImage(arr, multiscale.axes, omero, {}, autoBoost, originalShape);
}

export async function renderImage(
    arr: zarr.Array<any>,
    axes: Axis[],
    omero: Omero | null | undefined,
    sliceIndices: {[k: string]: (number | [number, number] | undefined)}  = {},
    autoBoost: boolean = false,
    originalShape?: number[],
    options: { signal?: AbortSignal } = {},
  ) {
    const { signal } = options;
    signal?.throwIfAborted();
    // Main rendering function...
    // We have the zarr Array already in hand, axes for dimensions
    // and omero for rendering settings
    // if autoBoost is true, check histogram and boost contrast if needed
    let shape = arr.shape;
  
    // NB: v0.2 no axes. v0.3 is just list of 'x', 'y', 'z', 'c', 't'
    // v0.4 onwards is list of Axis objects
    let axesNames = axes?.map((a) => a.name || a.toString()) || ['t', 'c', 'z', 'y', 'x'];
    let chDim = axesNames.indexOf("c");
    let channel_count = shape[chDim] || 1;
    let visibilities;
    // list of [r,g,b] colors
    let rgbColors: Array<[number, number, number]>;
    let luts: Array<string | undefined> | undefined = undefined;
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
      luts = omero.channels.map((ch) => "lut" in ch ? ch.lut as string : undefined);
    } else {
      visibilities = getDefaultVisibilities(channel_count);
      rgbColors = getDefaultColors(channel_count, visibilities);
    }
    // filter for active channels
    let activeChannelIndices = visibilities.reduce((prev, active, index) => {
      if (active) prev.push(index);
      return prev;
    }, []);
    rgbColors = activeChannelIndices.map((chIndex: number) => rgbColors[chIndex]);
    inverteds = activeChannelIndices.map((chIndex: number) => Boolean(omero?.channels[chIndex].inverted));
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
    let chSlices = getSlices(activeChannelIndices, shape, axesNames, sliceIndices, originalShape);
  
    // Wait for all chunks to be fetched...
    let promises = chSlices.map((chSlice: any) => zarr.get(arr, chSlice, { opts: { signal }}));
    let ndChunks = await Promise.all(promises);
    signal?.throwIfAborted();
  
    // Use start/end values from 'omero' if available, otherwise calculate min/max
    let minMaxValues = activeChannelIndices.map((chIndex:number, i:number) => {
        if (omero && omero.channels[chIndex]) {
            let chOmero = omero.channels[chIndex];
            if (chOmero?.window?.start !== undefined && chOmero?.window?.end !== undefined) {
                return [chOmero.window.start, chOmero.window.end];
            }
        }
        return getMinMaxValues(ndChunks[i]);
    });

    // Render to 8bit rgb array
    let rbgData = renderTo8bitArray(ndChunks, minMaxValues, rgbColors, luts, inverteds, autoBoost);
    // Use a canvas element to convert the 8bit array to a dataUrl
    const canvas = document.createElement("canvas");
    const height = ndChunks[0].shape[0];
    const width = ndChunks[0].shape[1];
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return "";
    }
    context.putImageData(new ImageData(rbgData, width, height), 0, 0);
    let dataUrl = canvas.toDataURL("image/png");
    return dataUrl;
  }

  