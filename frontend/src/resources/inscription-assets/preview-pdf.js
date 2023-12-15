import pdfjs from '/resources/inscription-assets/preview-pdf-pdfjs.js';
import { decodeDataURI } from '/resources/inscription-assets/decode-data-uri.js';


pdfjs.GlobalWorkerOptions.workerSrc = '/resources/inscription-assets/preview-pdf-pdf.worker.js';

let canvas = document.querySelector('canvas');

const pdf = await pdfjs.getDocument({data: decodeDataURI(window.pdfBase64) }).promise;
let page = await pdf.getPage(1);
let scale = window.devicePixelRatio || 1;
let viewport = page.getViewport({ scale });

canvas.width = Math.ceil(viewport.width * scale);
canvas.height = Math.ceil(viewport.height * scale);

page.render({
  canvasContext: canvas.getContext('2d'),
  transform: [scale, 0, 0, scale, 0, 0],
  viewport,
});
