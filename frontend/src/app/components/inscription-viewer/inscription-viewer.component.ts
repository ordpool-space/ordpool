import { Component, Input } from '@angular/core';

import { ParsedInscription } from '../../services/inscriptions/inscription-parser.service';

@Component({
  selector: 'app-inscription-viewer',
  templateUrl: './inscription-viewer.component.html',
  styleUrls: ['./inscription-viewer.component.scss'],
})
export class InscriptionViewerComponent {
  @Input() parsedInscription: ParsedInscription | undefined;

  table: { [key: string] : (dataUri: string) => string }

  constructor() {
    this.table = {
      'application/cbor': this.getPreviewUnknown,
      'application/json': this.getPreviewText,
      'application/pdf': this.getPreviewPdf,
      'application/pgp-signature': this.getPreviewText,
      'application/protobuf': this.getPreviewUnknown,
      'application/yaml': this.getPreviewText,
      'audio/flac': this.getPreviewAudio,
      'audio/mpeg': this.getPreviewAudio,
      'audio/wav': this.getPreviewAudio,
      'font/otf': this.getPreviewUnknown,
      'font/ttf': this.getPreviewUnknown,
      'font/woff': this.getPreviewUnknown,
      'font/woff2': this.getPreviewUnknown,
      'image/apng': this.getPreviewImage,
      'image/avif': this.getPreviewImage,
      'image/gif': this.getPreviewImage,
      'image/jpeg': this.getPreviewImage,
      'image/png': this.getPreviewImage,
      'image/svg+xml': this.getPreviewIframe,
      'image/webp': this.getPreviewImage,
      'model/gltf+json': this.getPreviewModel,
      'model/gltf-binary': this.getPreviewModel,
      'model/stl': this.getPreviewUnknown,
      'text/css': this.getPreviewText,
      'text/html': this.getPreviewIframe,
      'text/html;charset=utf-8': this.getPreviewIframe,
      'text/javascript': this.getPreviewText,
      'text/markdown': this.getPreviewMarkdown,
      'text/markdown;charset=utf-8': this.getPreviewMarkdown,
      'text/plain': this.getPreviewText,
      'text/plain;charset=utf-8': this.getPreviewText,
      'video/mp4': this.getPreviewVideo,
      'video/webm': this.getPreviewVideo,
    };
  }

  decodeBase64DataURI(dataUri: string) {
    const [, , data] = dataUri.match(/^data:.+\/(.+);base64,(.*)$/);
    return atob(data);
  }

  // all templates from here: https://github.com/ordinals/ord/tree/2c7f15cb6dc0ce0135e1c67676d75b687b5ee0ca/templates
  // see media-types here: https://github.com/ordinals/ord/blob/2c7f15cb6dc0ce0135e1c67676d75b687b5ee0ca/src/media.rs
  getPreview() {

    if (!this.parsedInscription) {
      return '';
    }

    const previewFunction = this.table[this.parsedInscription.contentType] || this.getPreviewUnknown;
    return previewFunction.call(this, this.parsedInscription.dataUri);
  }

  getPreviewIframe(dataUri: string): string {
    return this.decodeBase64DataURI(dataUri);
  }

  getPreviewAudio(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset=utf-8>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-audio.css'>
  </head>
  <body>
    <audio controls>
      <source src='${ dataUri }'>
    </audio>
  </body>
</html>`;
  }

  getPreviewImage(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <meta name='format-detection' content='telephone=no'>
    <style>
      html {
        background-color: #131516;
        height: 100%;
      }

      body {
        background-image: url('${ dataUri }');
        background-position: center;
        background-repeat: no-repeat;
        background-size: contain;
        height: 100%;
        image-rendering: pixelated;
        margin: 0;
      }

      img {
        height: 100%;
        opacity: 0;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <img src='${ dataUri }'></img>
  </body>
</html>`;
  }

  getPreviewMarkdown(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-markdown.css'></link>
    <script>window.markdownBase64 = '${ dataUri }'</script>
    <script src='/resources/inscription-assets/preview-markdown-marked.js'></script>
    <script src='/resources/inscription-assets/preview-markdown.js'></script>
  </head>
  <body>
  </body>
</html>`;
  }

  getPreviewModel(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <script type='module' src='/resources/inscription-assets/preview-model-viewer.js'></script>
    <style>
      model-viewer {
        position: fixed;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <model-viewer src='${ dataUri }' auto-rotate='true' camera-controls='true' shadow-intensity='1'></model-viewer>
  </body>
</html>`;
  }

  getPreviewPdf(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-pdf.css'>
    <script>window.pdfBase64 = '${ dataUri }'</script>
    <script src='/resources/inscription-assets/preview-pdf.js' defer type='module'></script>
  </head>
  <body>
    <canvas></canvas>
  </body>
</html>`;
  }

  getPreviewText(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <meta name='format-detection' content='telephone=no'>
    <link href='/resources/inscription-assets/preview-text.css' rel='stylesheet'>

    <script>window.textBase64 = '${ dataUri }'</script>
    <script src='/resources/inscription-assets/preview-text.js' defer></script>
  </head>
  <body>
    <pre></pre>
  </body>
</html>`;
  }

  getPreviewUnknown(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
  </head>
  <body>
    <h1 style="color:white;font-family: sans-serif;text-align:center;">Unknown!?</h1>
  </body>
</html>
`;
  }

getPreviewVideo(dataUri: string): string {

  return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-video.css'>
  </head>
  <body>
    <video controls loop muted autoplay>
      <source src="${ dataUri }">
    </video>
  </body>
</html>`;
  }
}
