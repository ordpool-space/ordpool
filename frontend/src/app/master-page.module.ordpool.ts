import { Cat21CollabComponent } from './components/_ordpool/cat21-collab/cat21-collab.component';
import { Cat21MintComponent } from './components/_ordpool/cat21-mint/cat21-mint.component';
import { Cat21WhitelistCheckerComponent } from './components/_ordpool/cat21-whitelist-checker/cat21-whitelist-checker.component';
import { OrdpoolStatsComponent } from './components/_ordpool/ordpool-stats/ordpool-stats.component';


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
    path: 'ordpool-stats/:type/:interval/:aggregation',
    component: OrdpoolStatsComponent
  }
];