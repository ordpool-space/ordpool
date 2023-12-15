import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { ParsedInscription, decodeDataURI } from 'ordpool-parser';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-inscription-viewer',
  templateUrl: './inscription-viewer.component.html',
  styleUrls: ['./inscription-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InscriptionViewerComponent {

  public _parsedInscription: ParsedInscription | undefined;
  public _lastParsedInscription: ParsedInscription | undefined;
  public formatedJSON = '';

  public preview?: SafeHtml;

  @Input()
  public set parsedInscription(inscription: ParsedInscription | undefined) {

    // the setter is called multiple times, let's mitigate that a bit
    if (this._lastParsedInscription?.getDataUri() === inscription?.getDataUri()) {
      return;
    }

    this._parsedInscription = inscription;
    this._lastParsedInscription = inscription;

    const contentString = inscription.getContentString();
    if (inscription.contentType.startsWith('text/plain') &&
      this.validateJson(contentString)) {
      this.formatedJSON = this.formatJSON(contentString);
    } else {
      this.formatedJSON = '';
    }
    const previewString = this.getPreview(inscription);
    this.preview = this.domSanitizer.bypassSecurityTrustHtml(previewString);
  }

  table: { [key: string]: (dataUri: string) => string } = {
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
    // 'image/jp2': this.getPreviewImage, // seen here 06158001c0be9d375c10a56266d8028b80ebe1ef5e2a9c9a4904dbe31b72e01ci0 - not supported by chrome!
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

  constructor(private domSanitizer: DomSanitizer) { }

  // all templates from here: https://github.com/ordinals/ord/tree/2c7f15cb6dc0ce0135e1c67676d75b687b5ee0ca/templates
  // see media-types here: https://github.com/ordinals/ord/blob/2c7f15cb6dc0ce0135e1c67676d75b687b5ee0ca/src/media.rs
  // see never version of media-types here: https://github.com/ordinals/ord/blob/bf37836667a9c58f74f1889f95b71d5a08bc1d77/src/media.rs#L50
  getPreview(inscription: ParsedInscription | undefined): string {

    if (!inscription) {
      return '';
    }

    const previewFunction = this.table[inscription.contentType] || this.getPreviewUnknown;
    return previewFunction.call(this, inscription.getDataUri());
  }

  /**
   * Checks if a given string is valid JSON.
   *
   * @param {string} str - The string to be tested.
   * @returns {boolean} Returns true if the string is valid JSON, otherwise false.
   */
  validateJson(str: string) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Formats a JSON string with indentation for better readability.
   *
   * @param {string} jsonString - The JSON string to be formatted.
   * @param {number} [indentation=2] - The number of spaces to use for indentation. Default is 4.
   * @returns {string} The formatted JSON string, or an error message if the input is not valid JSON.
   */
  formatJSON(jsonString, indentation = 2) {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, indentation);
  }

  // test here: http://localhost:4200/tx/751007cf3090703f241894af5c057fc8850d650a577a800447d4f21f5d2cecde
  getPreviewIframe(dataUri: string): string {
    return decodeDataURI(dataUri);
  }

  // test here: http://localhost:4200/tx/ad99172fce60028406f62725b91b5c508edd95bf21310de5afeb0966ddd89be3
  getPreviewAudio(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset=utf-8>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-audio.css'>
  </head>
  <body>
    <audio controls>
      <source src='${dataUri}'>
    </audio>
  </body>
</html>`;
  }

  // test here http://localhost:4200/tx/6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799
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
        background-image: url('${dataUri}');
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
    <img src='${dataUri}'></img>
  </body>
</html>`;
  }

  // test here: http://localhost:4200/tx/c133c03e2ed44bb8ada79b1640b6649129de75a8f31d8e6ad573ede442f91cdb
  getPreviewMarkdown(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-markdown.css'></link>
    <script>window.markdownBase64 = '${dataUri}'</script>
    <script src='/resources/inscription-assets/preview-markdown.js' type=module defer></script>
  </head>
  <body>
  </body>
</html>`;
  }

  // test here: http://localhost:4200/tx/25013a3ab212e0ca5b3ccbd858ff988f506b77080c51963c948c055028af2051
  getPreviewModel(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <script src='/resources/inscription-assets/preview-model-viewer.js' type='module'></script>
    <style>
      model-viewer {
        position: fixed;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <model-viewer src='${dataUri}' auto-rotate='true' camera-controls='true' shadow-intensity='1'></model-viewer>
  </body>
</html>`;
  }

  // test here: http://localhost:4200/tx/85b10531435304cbe47d268106b58b57a4416c76573d4b50fa544432597ad670i0
  // (shows only the first page)
  getPreviewPdf(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-pdf.css'>
    <script>window.pdfBase64 = '${dataUri}'</script>
    <script src='/resources/inscription-assets/preview-pdf.js' defer type='module'></script>
  </head>
  <body>
    <canvas></canvas>
  </body>
</html>`;
  }

  // test here: http://localhost:4200/tx/430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379
  getPreviewText(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <meta name='format-detection' content='telephone=no'>
    <link href='/resources/inscription-assets/preview-text.css' rel='stylesheet'>

    <script>window.textBase64 = '${dataUri}'</script>
    <script src='/resources/inscription-assets/preview-text.js' defer type='module'></script>
  </head>
  <body>
    <pre></pre>
  </body>
</html>`;
  }

  // test here: http://localhost:4200/tx/06158001c0be9d375c10a56266d8028b80ebe1ef5e2a9c9a4904dbe31b72e01c
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

  // test here: http://localhost:4200/tx/700f348e1acef6021cdee8bf09e4183d6a3f4d573b4dc5585defd54009a0148c
  getPreviewVideo(dataUri: string): string {

    return `<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8'>
    <link rel='stylesheet' href='/resources/inscription-assets/preview-video.css'>
  </head>
  <body>
    <video controls loop muted autoplay>
      <source src="${dataUri}">
    </video>
  </body>
</html>`;
  }
}
