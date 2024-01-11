import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-metadata-viewer',
  templateUrl: './metadata-viewer.component.html',
  styleUrls: ['./metadata-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetadataViewerComponent {

  @Input() data: any;

  isObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  isPrimitive(value: any): boolean {
    return typeof value !== 'object' && typeof value !== 'function';
  }

  getObjectKeys(obj: any): string[] {
    return Object.keys(obj);
  }
}
