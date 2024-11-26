import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { formatJSON } from 'ordpool-parser';

// json: http://localhost:4200/tx/49cbc5cbac92cf917dd4539d62720a3e528d17e22ef5fc47070a17ec0d3cf307
@Component({
  selector: 'app-json-viewer',
  templateUrl: './json-viewer.component.html',
  styleUrls: ['./json-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JsonViewerComponent {

  public formatedText = '';

  @Input()
  public set text(text: string | undefined) {

    if (text) {
      this.formatedText = formatJSON(text);
    } else {
      this.formatedText = '';
    }
  }
}
