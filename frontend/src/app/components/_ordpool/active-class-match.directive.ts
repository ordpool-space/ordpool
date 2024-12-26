import { Directive, Input, Renderer2, ElementRef, OnInit, inject, DestroyRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface ActiveClassMatchConfig {
  class: string;  // The css class to apply
  pattern: string; // The regex pattern for URL matching
}

@Directive({
  selector: '[activeClassMatch]',
  standalone: true,
})
export class ActiveClassMatchDirective implements OnInit {
  @Input('activeClassMatch') config!: ActiveClassMatchConfig;

  private router = inject(Router);
  private renderer = inject(Renderer2);
  private el = inject(ElementRef);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    if (!this.config || !this.config.pattern || !this.config.class) {
      throw new Error('activeClassMatch requires a valid configuration object with both "class" and "pattern" properties.');
    }

    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => {
        if (event instanceof NavigationEnd) {
          this.updateClass();
        }
      });

    // Initial check
    this.updateClass();
  }

  private updateClass(): void {
    const currentUrl = this.router.url;

    if (new RegExp(this.config.pattern).test(currentUrl)) {
      this.renderer.addClass(this.el.nativeElement, this.config.class);
    } else {
      this.renderer.removeClass(this.el.nativeElement, this.config.class);
    }
  }
}
