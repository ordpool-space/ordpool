import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';

import { StateService } from '../../../services/state.service';

@Component({
  selector: 'app-cat21-mint',
  templateUrl: './cat21-mint.component.html',
  styleUrls: ['./cat21-mint.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21MintComponent implements OnInit {

  form: FormGroup;


  constructor(
    private stateService: StateService,
    private formBuilder: FormBuilder
  ) { }

  ngOnInit(): void {
    this.form = this.formBuilder.group({
      fiat: [0],
      bitcoin: [0],
      satoshis: [0],
    });
  }
}
