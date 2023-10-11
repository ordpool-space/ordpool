import { marked } from '/resources/inscription-assets/preview-markdown-marked.js';

function decodeBase64DataURI(uri) {
  const [, , data] = uri.match(/^data:.+\/(.+);base64,(.*)$/);
  return atob(data);
}

const markdown = decodeBase64DataURI(window.markdownBase64);
document.body.innerHTML = marked.parse(markdown);
