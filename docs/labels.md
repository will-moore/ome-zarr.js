
# labels

We can use `ngffImage.getLabelsPaths()` to list any labels groups below a multiscales image.

These can then be opened as images and rendered as normal.

Alternatively, `ngffImage.renderRgba()` returns `rgba` values in an `Uint8ClampedArray`,
which we can then manipulate as shown below:

```js

function blackToTransparentRgba(d) {
    for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) {
        d[i + 3] = 0;
        }
    }
}

// load and render the parent image
let url = "https://livingobjects.ebi.ac.uk/idr/zarr/v0.4/idr0079A/idr0079_images.zarr/2/";
let img = await omezarr.NgffImage.load(url);
let imgSrc = await img.render({targetSize: 300});
document.getElementById("img").src = labelSrc;

// find labels and open the first label image
let labelPaths = await img.getLabelsPaths();
let labelImage = await omezarr.NgffImage.load(url + "labels/" + labelPaths[0]);
// Background will be rendered black
labelImage.setChannelLut(0, "glasbey_inverted.lut");

// renderRgba gives us an rgba array we can manipulate, to convert black to transparent
let {data, width} = await img.renderRgba({targetSize: 300);
blackToTransparentRgba(data)

// convert the rgba array back to image src
let labelSrc = await omezarr.convertRgbDataToDataUrl(data, width);
document.getElementById("labelImg").src = labelSrc;
```


<script setup>
import Labels from './components/Labels.vue';
</script>


<ClientOnly>
<Labels />
</ClientOnly>
