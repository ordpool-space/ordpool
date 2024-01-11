import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

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
      this.formatedText = this.formatJSON(text);
    } else {
      this.formatedText = '';
    }
  }

  /**
   * Formats a JSON string with indentation for better readability.
   *
   * @param jsonString - The JSON string to be formatted.
   * @param [indentation=2] - The number of spaces to use for indentation. Default is 4.
   * @returns The formatted JSON string, or an error message if the input is not valid JSON.
   */
  formatJSON(jsonString: string, indentation = 2) {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, indentation);
  }
}
