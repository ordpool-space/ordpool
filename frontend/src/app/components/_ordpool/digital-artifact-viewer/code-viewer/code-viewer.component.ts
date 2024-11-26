import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input } from '@angular/core';

import * as prettier from 'prettier';
import * as prettierPluginBabel from 'prettier/plugins/babel';
import * as prettierPluginEstree from 'prettier/plugins/estree';
import * as prettierPluginCss from 'prettier/plugins/postcss';

@Component({
  selector: 'app-code-viewer',
  templateUrl: './code-viewer.component.html',
  styleUrls: ['./code-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CodeViewerComponent {

  public formatedText = '';

  @Input()
  public set textAndContentType(t: { text: string, contentType: string | undefined } | undefined) {

    if (t?.text && t?.contentType) {  
      this.formatWithPrettier(t.text, t?.contentType);
    } else {
      this.formatedText = t?.text || '';
    }
  }

  constructor(private cd: ChangeDetectorRef) { }


  // css: http://localhost:4200/tx/73eb12c506adaf02e219229b1c800ea1caa70c86a981e8fdb9e231237957224fi0
  // js: http://localhost:4200/tx/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804db
  formatWithPrettier(source: string, contentType: string ) {

    let parser = '';
    // list of available parsers: https://prettier.io/docs/en/options#parser
    if (contentType.startsWith('text/css')) {
      parser = 'css';
    }

    if (contentType.startsWith('text/javascript') ||
        contentType.startsWith('application/x-javascript') ||
        contentType.startsWith('application/javascript')) {
      parser = 'babel';
    }

    prettier.format(source, {
      parser,
      plugins: [prettierPluginCss, prettierPluginBabel, prettierPluginEstree]
    }).then(formatedText => {
      this.formatedText = formatedText;
      this.cd.detectChanges();
    });
  }
}
