import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DigitalArtifact, DigitalArtifactType, ParsedAtomical, ParsedCat21, ParsedInscription, ParsedRunestone, ParsedSrc20 } from 'ordpool-parser';


@Component({
  selector: 'app-digital-artifact-viewer',
  templateUrl: './digital-artifact-viewer.component.html',
  styleUrls: ['./digital-artifact-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DigitalArtifactViewerComponent {

  private _parsedDigitalArtifact: DigitalArtifact | undefined;

  whatToShow: 'nothing' | 'src20' | 'runestone' | 'atomical' | 'inscription' | 'cat21' = 'nothing';

  @Input() showDetails = false;

  @Input()
  set digitalArtifact(artifact: DigitalArtifact | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._parsedDigitalArtifact?.uniqueId === artifact?.uniqueId) {
      return;
    }

    this._parsedDigitalArtifact = artifact;

    if (!artifact) {
      this.whatToShow = 'nothing';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Src20) {
      this.whatToShow = 'src20';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Runestone) {
      this.whatToShow = 'runestone';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Atomical) {
      this.whatToShow = 'atomical';
      return;
    }

    if (artifact.type === DigitalArtifactType.Inscription) {
      this.whatToShow = 'inscription';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Cat21) {
      this.whatToShow = 'cat21';
      return;
    }

    this.whatToShow = 'nothing';
  }

  get asCat21() {
    return this._parsedDigitalArtifact as ParsedCat21;
  }

  get asRunestone() {
    return this._parsedDigitalArtifact as ParsedRunestone;
  }

  get asAtomical() {
    return this._parsedDigitalArtifact as ParsedAtomical;
  }

  get asInscription() {
    return this._parsedDigitalArtifact as ParsedInscription;
  }

  get asSrc20() {
    return this._parsedDigitalArtifact as ParsedSrc20;
  }

}
