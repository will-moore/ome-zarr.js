# renderThumbnail

::: warning
ome-zarr.js is not yet stable and the API may change in patch releases.
:::

## Default usage

By default, `renderThumbnail(url)` will use the smallest resolution `dataset` from the
`multiscales` pyramid.

It will also use any [omero](https://ngff.openmicroscopy.org/latest/index.html#omero-md)
rendering settings in the image metadata to choose active channels and colors.

```js
import * as omezarr from "https://cdn.jsdelivr.net/npm/ome-zarr.js/+esm";

let url = "https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr";
let thumbSrc = await omezarr.renderThumbnail(url);
document.getElementById("thumbnail").src = thumbSrc;
```

The thumbnails below are rendered at their natural size, corresponding to the smallest
resolution for each `OME-Zarr` Image. Click the thumbnails to inspect each Image in `ome-ngff-validator`:

<script setup>
import Thumbnail from './components/Thumbnail.vue';
import ThumbnailTest from './components/ThumbnailTest.vue';
</script>

<!-- ClientOnly because ome-zarr.js uses browser API: document.createElement('canvas') -->
<ClientOnly>
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.1/9836841.zarr" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.2/idr0070A/9838562.zarr/0/" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0048A/9846151.zarr/0/" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240_ngff-zarr.ome.zarr" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0083A/9822152.zarr" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.5/idr0066/ExpD_chicken_embryo_MIP.ome.zarr" />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.3/idr0079A/9836998.zarr" />
<Thumbnail url="https://s3.janelia.org/funceworm/test-uint64-small.zarr/" />
</ClientOnly>

<div :class="$style.thumb_container"></div>

## Target Size

You can choose a preferred `targetSize` and the `dataset` where the longest side (`x` or `y`)
is closest to the `targetSize` will be chosen.

```js
let thumbSrc = await omezarr.renderThumbnail(url, 300);
```

<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0048A/9846151.zarr/0/" targetSize=300 />
<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.3/idr0079A/9836998.zarr" targetSize=300 />

<!-- Thumbnail are float:left so we need to clear that -->
<div :class="$style.thumb_container"></div>

## Auto-boost

The intensity levels for each channel are mapped over the full intensity range of the
pixels in the image. We find the `min` and `max` intensity values and then render the
`min` intensity to black and the `max` to e.g. red, green, blue or white. However, if
one or two pixels are much brighter than the rest, this can result in a dim image.

If `autoBoost` is `true`, then a histogram is calculated and if the top `20%` of the
histogram has less than `1%` of pixels then we double the intensity of all pixels.

```js
let thumbSrc = await omezarr.renderThumbnail(url, 200, true);
```

Here we show the same Image thumbnail, with `autoBoost = false` and with `autoBoost = true`.

<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.5/idr0066/ExpD_chicken_embryo_MIP.ome.zarr"
 targetSize=200 />

<Thumbnail url="https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.5/idr0066/ExpD_chicken_embryo_MIP.ome.zarr"
 targetSize=200 autoBoost=true />

<div :class="$style.thumb_container"></div>

::: tip
We only attempt to perform `autoBoost` if the initial render process took less than 100 millisecs, so
as not to cause performance issues with larger images.
:::


## Max Size

We want to avoid attempts to render massive images. If the smallest resolution level
has `width x height` greater than `maxSize x maxSize` then `renderThumbnail()` will throw an `Error`,
with the default `maxSize` being `1000`.

To change that threshold, we can specify a different value:

```js
let maxSize = 1500;
let targetSize = 500;
let thumbSrc = await omezarr.renderThumbnail(url, targetSize, false, maxSize);
```

## Test renderThumbnail()

Here you can test `renderThumbnail()` with your own images.

<ClientOnly>
<ThumbnailTest />
</ClientOnly>


## What's being loaded?

Under the hood, `renderThumbnail()` makes several calls to fetch `zarr` metadata and chunks:

 - When we open the `multiscales` group with `zarr.open(store, { kind: "group" })` then `zarrita.js` will
 attempt to fetch the `.zgroup` and `.zattrs`. If these are not found (for `zarr v3` data) then it will
 fetch the `zarr.json` for `zarr v3`.
 - We then fetch the array metadata for the lowest resolution dataset. Since we now know whether the
 data is `zarr v2` or `v3`, we directly load the `.zarray` or `zarr.json`. This gives us the `shape` of
 the lowest resolution array and so we can calculate the sizes of the other arrays in the multiscales pyramid.
 - If we have chosen a `targetSize` which specifies a different dataset, we also fetch that array metadata.
 - Finally we fetch the array chunks required to render an image plane for each active channel.

<style module>
.thumb_container {
  clear: left;
}
</style>

<!-- Check out the documentation for the [full list of markdown extensions](https://vitepress.dev/guide/markdown). -->
