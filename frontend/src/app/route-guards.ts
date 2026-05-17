import { Injectable, inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { NavigationService } from '@app/services/navigation.service';

@Injectable({
  providedIn: 'root'
})
class GuardService {
  constructor(
    private router: Router,
    private navigationService: NavigationService,
  ) {}

  trackerGuard(route: Route, segments: UrlSegment[]): boolean {
    // HACK -- Ordpool: skip the mobile tracker view entirely. Upstream
    // mempool sends mobile + initial-load /tx/<id> visits to a simplified
    // "your transaction is confirmed!" page (TrackerComponent), branded
    // mempool and lacking Ordpool's artifact viewers / OTS panel / flag
    // chips -- everything a deep-link from cat21-indexer or a tweet was
    // supposed to land on. Always return false so /tx/* falls through to
    // the full TransactionComponent under the master-page route.
    return false;
    /* HACK -- Ordpool: original upstream condition preserved for future
       merges:
    const preferredRoute = this.router.getCurrentNavigation()?.extractedUrl.queryParams?.mode;
    const path = this.router.getCurrentNavigation()?.extractedUrl.root.children.primary.segments;
    return (preferredRoute === 'status' || (preferredRoute !== 'details' && this.navigationService.isInitialLoad())) && window.innerWidth <= 767.98 && !(path.length === 2 && ['push', 'test', 'preview'].includes(path[1].path));
    */
  }
}

export const TrackerGuard: CanMatchFn = (route: Route, segments: UrlSegment[]): boolean => {
  return inject(GuardService).trackerGuard(route, segments);
};
