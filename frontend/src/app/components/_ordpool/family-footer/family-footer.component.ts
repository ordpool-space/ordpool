import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ORDPOOL_FAMILY, ORDPOOL_FAMILY_HEADING, ordpoolFamilyLede, OrdpoolFamilyMember } from 'ordpool-sdk';

/**
 * The Ordpool-family strip: one row per sibling product (ordpool.space,
 * cat21.space, cubes, Cat21 Wallet), each with the one line that says why it
 * earns a click. Rendered above the site footer to introduce the family and
 * carry the network effect between the four surfaces.
 *
 * All copy is read from the SDK (`ORDPOOL_FAMILY*`), never retyped, so the
 * same sentence prints identically on every site. This site marks its own row
 * ("You're here") rather than dropping it, so a visitor sees the whole set of
 * four from any vantage point.
 */
@Component({
  selector: 'app-family-footer',
  templateUrl: './family-footer.component.html',
  styleUrls: ['./family-footer.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyFooterComponent {
  /**
   * This site's stable family key, hardcoded. Never host-matched: on
   * localhost, a preview deploy or any dev server `location.host` matches no
   * member, which would silently unmark the current row. The site knows which
   * site it is.
   */
  readonly currentKey: OrdpoolFamilyMember['key'] = 'ordpool';

  readonly heading = ORDPOOL_FAMILY_HEADING;
  // Per-site lede: names this site's own medium ("a JPEG"). The footer
  // introduces the family and carries no safety claim; the coin-check promise
  // lives in the single-address caveat, at the action, where it can be acted on.
  readonly lede = ordpoolFamilyLede('ordpool');
  readonly members = ORDPOOL_FAMILY;

  isCurrent(member: OrdpoolFamilyMember): boolean {
    return member.key === this.currentKey;
  }
}
