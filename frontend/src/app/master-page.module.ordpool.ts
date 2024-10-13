
import { Cat21MintComponent } from './components/ordinals/cat21-mint/cat21-mint.component';
import { Cat21CollabComponent } from './components/ordinals/cat21-collab/cat21-collab.component';
import { Cat21WhitelistCheckerComponent } from './components/ordinals/cat21-whitelist-checker/cat21-whitelist-checker.component';
import { OrdpoolStatsComponent } from './components/ordinals/ordpool-stats/ordpool-stats.component';

export const extraOrdpoolRoutes = [
  {
    path: 'cat21-mint',
    component: Cat21MintComponent,
  },
  {
    path: 'cat21-collab',
    component: Cat21CollabComponent,
  },
  {
    path: 'cat21-whitelist-checker',
    component: Cat21WhitelistCheckerComponent,
  },
  {
    path: 'ordpool-stats',
    component: OrdpoolStatsComponent
  },
];