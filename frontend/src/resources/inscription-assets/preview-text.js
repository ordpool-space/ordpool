function decodeBase64DataURI(uri) {
  const [, , data] = uri.match(/^data:.+\/(.+);base64,(.*)$/);
  return atob(data);
}

const text = decodeBase64DataURI(window.textBase64);


let pre = document.querySelector('body > pre');
pre.innerText = text;

let { width, height } = pre.getBoundingClientRect();
let columns = width / 16;
let rows = height / 16;
pre.style.fontSize = `min(${95/columns}vw, ${95/rows}vh)`;
pre.style.opacity = 1;
