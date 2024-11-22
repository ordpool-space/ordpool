import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { SeoService } from '../../../services/seo.service';


@Component({
  selector: 'app-cat21-collab',
  templateUrl: './cat21-collab.component.html',
  styleUrls: ['./cat21-collab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21CollabComponent {

  seoService = inject(SeoService);

  ngOnInit() {
    this.seoService.setTitle('CAT-21: Invitation to Collaborate');
    this.seoService.setDescription('We are thrilled to offer you and your community the chance to participate in a new, fun protocol built on top of Bitcoin ordinals – created by the maker of Ordpool!');
  }
}
