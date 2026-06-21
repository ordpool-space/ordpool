import { DomSanitizer, SafeResourceUrl  } from '@angular/platform-browser';
import { Pipe, PipeTransform } from '@angular/core';

// SECURITY LOCK: only safe inside a `sandbox="allow-scripts"` iframe
// WITHOUT `allow-same-origin`. Do not use elsewhere or relax the sandbox.
@Pipe({
  name: 'safeResourceUrl',
  standalone: true
})
export class SafeResourceUrlPipe implements PipeTransform  {

   constructor(private sanitizer: DomSanitizer) { }

   transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
   }
}
