<script setup>
import { onMounted } from "vue";
import { ref } from "vue";

const imgSrc = ref("");
const labelSrc = ref("");

const VURL = "https://ome.github.io/ome-ngff-validator/?source=";

onMounted(async () => {
  // This loads from http://localhost:5173/ome-zarr.js/@fs/Users/wmoore/Desktop/ZARR/ome-zarr.js/dist/ome-zarr.js
  // NB: needs `npm run build` first!
  const omezarr = await import("ome-zarr.js");

  function blackToTransparentRgba(d) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) {
        d[i + 3] = 0;
      }
    }
  }

  let url =
    "https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0079A/idr0079_images.zarr/2/";
  let img = await omezarr.NgffImage.load(url);
  imgSrc.value = await img.render({ targetSize: 300 });

  let labelPaths = await img.getLabelsPaths();
  let labelImage = await omezarr.NgffImage.load(
    url + "labels/" + labelPaths[0]
  );
  labelImage.setChannelActive(0, true);
  labelImage.setChannelLut(0, "glasbey_inverted.lut");

  // renderRgba gives us an rgba array we can manipulate, to convert black to transparent
  let labelRgba = await labelImage.renderRgba({ targetSize: 300 });
  blackToTransparentRgba(labelRgba.data);

  // convert the rgba array back to image src
  labelSrc.value = await omezarr.convertRgbDataToDataUrl(
    labelRgba.data,
    labelRgba.width
  );
});
</script>

<template>
  <a
    :href="
      VURL +
      `https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0079A/idr0079_images.zarr/2/`
    "
    target="_blank"
  >
    <img v-if="imgSrc" alt="thumbnail" :src="imgSrc" />
    <img v-if="labelSrc" :class="$style.renderedImage" alt="label" :src="labelSrc" />
  </a>

  <p>
    Overlay both the images above:
  </p>

  <div :class="$style.overlay">
    <img v-if="imgSrc" alt="thumbnail" :src="imgSrc" />
    <img v-if="labelSrc" :class="$style.fadeInOut" alt="label" :src="labelSrc" />
  </div>
</template>

<style module>
img {
  margin: 10px 0;
}
.renderedImage {
  /* background pattern for transparency */
  background:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}

.overlay {
  position: relative;
}
.overlay :nth-child(2) {
  position: absolute;
  top: 0;
  left: 0;
  margin-top: 0;
}

.fadeInOut {
  animation: fadeInOut 3s ease-in-out infinite;
}
@keyframes fadeInOut {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.1;
  }
}
</style>
