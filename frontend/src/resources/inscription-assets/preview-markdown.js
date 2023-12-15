import { marked } from '/resources/inscription-assets/preview-markdown-marked.js';
import { decodeDataURI } from '/resources/inscription-assets/decode-data-uri.js';


const markdown = decodeDataURI(window.markdownBase64);
document.body.innerHTML = marked.parse(markdown);
