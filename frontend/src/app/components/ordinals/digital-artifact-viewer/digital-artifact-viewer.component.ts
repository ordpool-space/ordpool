import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DigitalArtifact, DigitalArtifactType, ParsedInscription } from 'ordpool-parser';


@Component({
  selector: 'app-digital-artifact-viewer',
  templateUrl: './digital-artifact-viewer.component.html',
  styleUrls: ['./digital-artifact-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DigitalArtifactViewerComponent {

  public _parsedDigitalArtifact: DigitalArtifact | undefined;
  private _lastParsedDigitalArtifact: DigitalArtifact | undefined;

  public whatToShow: 'nothing' | 'inscription' | 'src20' | 'cat21' = 'nothing';

  @Input() showDetails = false;

  @Input()
  public set digitalArtifact(artifact: DigitalArtifact | undefined) {

    // early exit if setter is called multiple times (don't remove!)
    if (this._lastParsedDigitalArtifact?.uniqueId === artifact?.uniqueId) {
      return;
    }

    this._parsedDigitalArtifact = artifact;
    this._lastParsedDigitalArtifact = artifact;

    if (!artifact) {
      this.whatToShow = 'nothing';
      return;
    }

    if (artifact.type === DigitalArtifactType.Inscription) {
      this.whatToShow = 'inscription';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Src20) {
      this.whatToShow = 'src20';
      return;
    }

    if (artifact.type  === DigitalArtifactType.Cat21) {
      this.whatToShow = 'cat21';
      return;
    }

    this.whatToShow = 'nothing';
  }

  get asInscription() {
    return this._parsedDigitalArtifact as ParsedInscription;
  }
}
