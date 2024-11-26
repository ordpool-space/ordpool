
import { decodeDataURI } from '/resources/inscription-assets/decode-data-uri.js';

const text = decodeDataURI(window.textBase64);

let code = document.querySelector('body > pre > code');
let pre = document.querySelector('body > pre');

// ⚠️ This helps mitigate Cross-Site Scripting (XSS) attacks.
// ⚠️ NEVER insert the content directly into the HTML using innerHTML or other methods.
// ⚠️ Always use innerText to safely render text content.
code.innerText = text;

// no zooming for json, just enable opacity
pre.style.opacity = 1;
