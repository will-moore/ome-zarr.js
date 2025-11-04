<script setup>

import { onMounted } from 'vue';
import { ref } from 'vue'

const VURL = "https://ome.github.io/ome-ngff-validator/?source=";

const imgSrc = ref(null);

// const props = defineProps(['url']);

// We store image array and metadata in these refs
let arrRef = null;
// const omeroRef = ref({ channels: [] });
// const multiscaleRef = ref(null);
const url = ref("https://uk1s3.embassy.ebi.ac.uk/idr/zarr/v0.4/idr0062A/6001240.zarr");
const targetSize = ref(100);
const setTargetSize = ref(true);
const boostRef = ref(false);
const errorMsg = ref("");
const maxSize = ref(1000);
const setMaxSize = ref(false);

const imgInfo = ref(null);
const naturalWidth = ref(0);
const naturalHeight = ref(0);

const maxWidth = 450;

let omezarr;

let debounceTimeout = null;

function handleUrl(event) {
  // url.value = event.target.value;

  // debounce render() 200ms
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
  debounceTimeout = setTimeout(() => {
    console.log('handleUrl', event.target.value);
    render();
  }, 200);
}

onMounted(async () => {
  // This loads from http://localhost:5173/ome-zarr.js/@fs/Users/wmoore/Desktop/ZARR/ome-zarr.js/dist/ome-zarr.js
  // NB: needs `npm run build` first!
  omezarr = await import('ome-zarr.js');
  render();
});


async function render() {
  // Render the Thumbnail()....
  imgSrc.value = null;
  errorMsg.value = "";
  imgInfo.value = null;
  naturalHeight.value = 0;
  naturalWidth.value = 0;

  let targetSz = undefined;
  let maxSz = undefined;
  if (setMaxSize.value) {
    maxSz = parseInt(maxSize.value);
  }
  if (setTargetSize.value) {
    targetSz = parseInt(targetSize.value);
  }

  try {
    imgSrc.value = await omezarr.renderThumbnail(url.value, targetSz, boostRef.value, maxSz);

    // Use Image() to find intrinsic size
    const img = new Image();
    img.onload = () => {
      naturalWidth.value = img.width;
      naturalHeight.value = img.height;
    };
    img.src = imgSrc.value;

  } catch (error) {
    console.error("Error rendering thumbnail:", error);
    errorMsg.value = "Error rendering thumbnail: " + error;
  }

  // Also load image info for debugging
  imgInfo.value = await omezarr.getMultiscaleWithArray(url.value);
  console.log("Image info:", imgInfo.value);
};
</script>

<template>

  <div :class="$style.viewer">
    <div>
      <input type="text" @input="event => text = handleUrl(event)" v-model="url">
    </div>
    <div :class="$style.row">
      <label for="setTargetSize">Set Target Size</label>
      <input type="checkbox" id="setTargetSize" v-model="setTargetSize" @change="render" />
      <input :disabled="!setTargetSize" type="range" min="1" max="500" step="1" v-model="targetSize"
        @change="event => text = handleUrl(event)" />
      <label>targetSize: {{ targetSize }}</label>
    </div>
    <div :class="$style.row">
      <label for="autoBoost">Auto Boost:</label>
      <input type="checkbox" id="autoBoost" v-model="boostRef" @change="render" />
    </div>
    <div :class="$style.row">
      <label for="setMaxSize">Set Max Size:</label>
      <input type="checkbox" id="setMaxSize" v-model="setMaxSize" @change="render" />
      <input :disabled="!setMaxSize" type="range" min="100" max="2000" step="1" v-model="maxSize"
        @change="event => text = handleUrl(event)" />
      <label>maxSize: {{ maxSize }}</label>
    </div>
    <div>
      <img :class="$style.renderedImage" :src="imgSrc" :style="{ maxWidth: maxWidth + 'px', float: 'none' }" />
    </div>
    <div v-if="errorMsg" :style="{ color: 'red' }">{{ errorMsg }}</div>
    <div v-if="imgInfo">
      <h4>Image Info:</h4>
      <div>Thumbnail size: {{ naturalWidth }} x {{ naturalHeight }}</div>
      <div>
        Shapes (from scales info):
        <code v-for="shape in imgInfo.shapes" :key="shape.join(', ')">
          ({{ shape.join(", ") }})
        </code>
      </div>
    </div>
  </div>

</template>

<style module>
input[type="text"] {
  vertical-align: middle;
  width: 100%;
  font-size: 16px;
  border: solid 1px #ccc;
  padding: 5px;
  border-radius: 5px;
  ;
}

label {
  display: inline-block;
  font-size: 12px;
}

.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
}
</style>
