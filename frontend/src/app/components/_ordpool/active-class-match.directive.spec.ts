import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router, NavigationEnd } from '@angular/router';
import { ActiveClassMatchDirective } from './active-class-match.directive'; // Adjust the path if needed
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';


describe('ActiveClassMatch regex tests', () => {
  const pattern = '^\\/(?:[a-zA-Z0-9-]+\\/)?(block|mempool-block)/.*';

  it('should match valid block URLs', () => {
    expect(new RegExp(pattern).test('/block/12345')).toBe(true);
    expect(new RegExp(pattern).test('/mempool-block/56789')).toBe(true);
    expect(new RegExp(pattern).test('/testnet/block/12345')).toBe(true);
    expect(new RegExp(pattern).test('/testnet/mempool-block/56789')).toBe(true);
  });

  it('should not match invalid URLs', () => {
    expect(new RegExp(pattern).test('block/12345')).toBe(false); // Missing leading slash
    expect(new RegExp(pattern).test('mempool-block/56789')).toBe(false); // Missing leading slash
    expect(new RegExp(pattern).test('/non-matching/route')).toBe(false);
    expect(new RegExp(pattern).test('/block')).toBe(false); // No trailing slash or additional content
  });
});


@Component({
  template: `
    <a [activeClassMatch]="{ class: 'active', pattern: '^\\/(?:[a-zA-Z0-9-]+\\/)?(block|mempool-block)/.*' }">
      Test Link
    </a>
  `,
  standalone: true,
  imports: [ActiveClassMatchDirective],
})
class TestHostComponent {}

describe('ActiveClassMatchDirective', () => {
  let router: Router;
  let events$: Subject<any>;

  beforeEach(async () => {
    events$ = new Subject();

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    router = TestBed.inject(Router);

    // Mock the router.events observable
    jest.spyOn(router.events, 'pipe').mockReturnValue(events$ as any);
  });

  it('should add the "active" class when the route matches the pattern', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    const anchor = fixture.debugElement.query(By.css('a'));

    // Mock the current URL
    Object.defineProperty(router, 'url', { value: '/block/12345', writable: true });

    // Simulate navigation to a matching route
    events$.next(new NavigationEnd(1, '/block/12345', '/block/12345'));
    fixture.detectChanges();

    expect(anchor.nativeElement.classList).toContain('active');
  });

  it('should not add the "active" class when the route does not match the pattern', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    const anchor = fixture.debugElement.query(By.css('a'));

    // Mock the current URL
    Object.defineProperty(router, 'url', { value: '/non-matching/route', writable: true });

    // Simulate navigation to a non-matching route
    events$.next(new NavigationEnd(1, '/non-matching/route', '/non-matching/route'));
    fixture.detectChanges();

    expect(anchor.nativeElement.classList).not.toContain('active');
  });

  it('should remove the "active" class when navigating from a matching to a non-matching route', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    const anchor = fixture.debugElement.query(By.css('a'));

    // Mock the current URL for a matching route
    Object.defineProperty(router, 'url', { value: '/block/12345', writable: true });
    events$.next(new NavigationEnd(1, '/block/12345', '/block/12345'));
    fixture.detectChanges();
    expect(anchor.nativeElement.classList).toContain('active');

    // Mock the current URL for a non-matching route
    Object.defineProperty(router, 'url', { value: '/non-matching/route', writable: true });
    events$.next(new NavigationEnd(2, '/non-matching/route', '/non-matching/route'));
    fixture.detectChanges();
    expect(anchor.nativeElement.classList).not.toContain('active');
  });
});
