import { Component, EventEmitter, Output, HostListener, Input, ChangeDetectorRef, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core';
import { ActiveFilter, FilterGroups, FilterMode, GradientMode, TransactionFilters } from '@app/shared/filters.utils';
import { StateService } from '@app/services/state.service';
import { Subscription } from 'rxjs';
// HACK -- Ordpool: labitbu chip is hidden on blocks outside the minting
// window. Shared range predicate, also used inside LabitbuParserService.
import { isLabitbuRange } from 'ordpool-parser';


@Component({
  selector: 'app-block-filters',
  templateUrl: './block-filters.component.html',
  styleUrls: ['./block-filters.component.scss'],
  standalone: false,
})
export class BlockFiltersComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cssWidth: number = 800;
  @Input() excludeFilters: string[] = [];
  // HACK -- Ordpool: block height of the block being viewed (null for the
  // mempool / cluster views). Used to hide the labitbu filter chip outside
  // the labitbu mint window.
  @Input() blockHeight: number | null = null;
  @Output() onFilterChanged: EventEmitter<ActiveFilter | null> = new EventEmitter();

  filterSubscription: Subscription;

  filters = TransactionFilters;
  filterGroups = FilterGroups;
  disabledFilters: { [key: string]: boolean } = {};
  activeFilters: string[] = [];
  filterFlags: { [key: string]: boolean } = {};
  filterMode: FilterMode = 'and';
  gradientMode: GradientMode = 'fee';
  // HACK: menu always open
  // menuOpen: boolean = false;
  menuOpen: boolean = true;

  constructor(
    private stateService: StateService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.filterSubscription = this.stateService.activeGoggles$.subscribe((active: ActiveFilter) => {
      this.applyActiveGoggles(active);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.cssWidth) {
      this.cd.markForCheck();
    }
    if (changes.excludeFilters || changes.blockHeight) {
      this.disabledFilters = {};
      this.excludeFilters.forEach(filter => {
        this.disabledFilters[filter] = true;
      });
      // HACK -- Ordpool: hide labitbu chip outside the mint window.
      // Mempool / cluster / Next Block views have blockHeight null,
      // which isLabitbuRange treats as outside.
      if (!isLabitbuRange(this.blockHeight)) {
        this.disabledFilters['ordpool_labitbu'] = true;
      }
      // HACK -- Ordpool: re-sync active filters whenever `disabledFilters`
      // changes. Without this, a filter that started disabled (e.g. labitbu
      // when the component mounted before `blockHeight` flowed in) stays
      // pruned from `activeFilters` even after the gate later opens.
      if (this.filterSubscription) {
        this.applyActiveGoggles(this.stateService.activeGoggles$.value);
      }
    }
  }

  private applyActiveGoggles(active: ActiveFilter): void {
    this.filterMode = active.mode;
    this.gradientMode = active.gradient;
    for (const key of Object.keys(this.filterFlags)) {
      this.filterFlags[key] = false;
    }
    for (const key of active.filters) {
      this.filterFlags[key] = !this.disabledFilters[key];
    }
    this.activeFilters = [...active.filters.filter(key => !this.disabledFilters[key])];
    this.onFilterChanged.emit({ mode: active.mode, filters: this.activeFilters, gradient: this.gradientMode });
  }

  setFilterMode(mode): void {
    this.filterMode = mode;
    this.onFilterChanged.emit({ mode: this.filterMode, filters: this.activeFilters, gradient: this.gradientMode });
    this.stateService.activeGoggles$.next({ mode: this.filterMode, filters: [...this.activeFilters], gradient: this.gradientMode });
  }

  setGradientMode(mode): void {
    this.gradientMode = mode;
    this.onFilterChanged.emit({ mode: this.filterMode, filters: this.activeFilters, gradient: this.gradientMode });
    this.stateService.activeGoggles$.next({ mode: this.filterMode, filters: [...this.activeFilters], gradient: this.gradientMode });
  }

  toggleFilter(key): void {
    const filter = this.filters[key];
    this.filterFlags[key] = !this.filterFlags[key];
    if (this.filterFlags[key]) {
      // remove any other flags in the same toggle group
      if (filter.toggle) {
        this.activeFilters.forEach(f => {
          if (this.filters[f].toggle === filter.toggle) {
            this.filterFlags[f] = false;
          }
        });
        this.activeFilters = this.activeFilters.filter(f => this.filters[f].toggle !== filter.toggle);
      }
      // add new active filter
      this.activeFilters.push(key);
    } else {
      // remove active filter
      this.activeFilters = this.activeFilters.filter(f => f != key);
    }
    const booleanFlags = this.getBooleanFlags();
    this.onFilterChanged.emit({ mode: this.filterMode, filters: this.activeFilters, gradient: this.gradientMode });
    this.stateService.activeGoggles$.next({ mode: this.filterMode, filters: [...this.activeFilters], gradient: this.gradientMode });
  }

  getBooleanFlags(): bigint | null {
    let flags = 0n;
    for (const key of Object.keys(this.filterFlags)) {
      if (this.filterFlags[key]) {
        flags |= this.filters[key].flag;
      }
    }
    return flags || null;
  }

  // HACK -- menu always open
  // @HostListener('document:click', ['$event'])
  // onClick(event): boolean {
  //   // click away from menu
  //   if (!event.target.closest('button, label, .btn-check')) {
  //     this.menuOpen = false;
  //   }
  //   return true;
  // }

  ngOnDestroy(): void {
    this.filterSubscription.unsubscribe();
  }
}
