import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  DigitalArtifact,
  DigitalArtifactType,
  ParsedAtomical,
  ParsedCat21,
  ParsedCounterparty,
  ParsedInscription,
  ParsedLabitbu,
  ParsedRunestone,
  ParsedSrc101,
  ParsedSrc20,
  ParsedSrc721,
  ParsedStamp,
} from 'ordpool-parser';

type ViewerKind =
  | 'nothing'
  | 'src20'
  | 'runestone'
  | 'atomical'
  | 'inscription'
  | 'cat21'
  | 'counterparty'
  | 'stamp'
  | 'src721'
  | 'src101'
  | 'labitbu';

const TYPE_TO_KIND: Partial<Record<DigitalArtifactType, ViewerKind>> = {
  [DigitalArtifactType.Src20]: 'src20',
  [DigitalArtifactType.Runestone]: 'runestone',
  [DigitalArtifactType.Atomical]: 'atomical',
  [DigitalArtifactType.Inscription]: 'inscription',
  [DigitalArtifactType.Cat21]: 'cat21',
  [DigitalArtifactType.Counterparty]: 'counterparty',
  [DigitalArtifactType.Stamp]: 'stamp',
  [DigitalArtifactType.Src721]: 'src721',
  [DigitalArtifactType.Src101]: 'src101',
  [DigitalArtifactType.Labitbu]: 'labitbu',
};

@Component({
  selector: 'app-digital-artifact-viewer',
  templateUrl: './digital-artifact-viewer.component.html',
  styleUrls: ['./digital-artifact-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DigitalArtifactViewerComponent {

  private _parsedDigitalArtifact: DigitalArtifact | undefined;

  whatToShow: ViewerKind = 'nothing';

  @Input() showDetails = false;

  @Input()
  set digitalArtifact(artifact: DigitalArtifact | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._parsedDigitalArtifact?.uniqueId === artifact?.uniqueId) {
      return;
    }

    this._parsedDigitalArtifact = artifact;
    this.whatToShow = artifact ? (TYPE_TO_KIND[artifact.type] ?? 'nothing') : 'nothing';
  }

  get asCat21() { return this._parsedDigitalArtifact as ParsedCat21; }
  get asRunestone() { return this._parsedDigitalArtifact as ParsedRunestone; }
  get asAtomical() { return this._parsedDigitalArtifact as ParsedAtomical; }
  get asInscription() { return this._parsedDigitalArtifact as ParsedInscription; }
  get asSrc20() { return this._parsedDigitalArtifact as ParsedSrc20; }
  get asCounterparty() { return this._parsedDigitalArtifact as ParsedCounterparty; }
  get asStamp() { return this._parsedDigitalArtifact as ParsedStamp; }
  get asSrc721() { return this._parsedDigitalArtifact as ParsedSrc721; }
  get asSrc101() { return this._parsedDigitalArtifact as ParsedSrc101; }
  get asLabitbu() { return this._parsedDigitalArtifact as ParsedLabitbu; }
}
