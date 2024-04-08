import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Observable, interval, map, startWith, takeWhile } from 'rxjs';

@Component({
  selector: 'app-countdown-timer',
  templateUrl: './countdown-timer.component.html',
  styleUrls: ['./countdown-timer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CountdownTimerComponent implements OnInit {

  @Input()
  targetDate: string | undefined;
  countdown$: Observable<string>;

  ngOnInit() {
    this.countdown$ = interval(1000).pipe(
      startWith(0),
      map(() => {

        if (!this.targetDate) {
          return '';
        }

        const now = new Date().getTime();
        const distance = new Date(this.targetDate).getTime() - now;

        if (distance < 0) {
          return 'GO';
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
      }),
      takeWhile(countdown => countdown !== 'GO', true)
    );
  }
}
