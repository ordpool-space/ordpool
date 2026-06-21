import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// SECURITY LOCK: only safe inside a `sandbox="allow-scripts"` iframe
// WITHOUT `allow-same-origin`. Do not use elsewhere or relax the sandbox.
@Pipe({
  name: 'safeHtml',
  standalone: true
})
export class SafeHtmlPipe implements PipeTransform  {

   constructor(private sanitizer: DomSanitizer) { }

   transform(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
   }
}
