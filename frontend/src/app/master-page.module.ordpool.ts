import { Cat21MintComponent } from './components/_ordpool/cat21-mint/cat21-mint.component';
import { OrdpoolStatsComponent } from './components/_ordpool/ordpool-stats/ordpool-stats.component';
import { OpenTimestampsComponent } from './components/_ordpool/open-timestamps/open-timestamps.component';


export const extraOrdpoolRoutes = [
  {
    path: 'cat21-mint',
    component: Cat21MintComponent,
  },
  {
    path: 'ordpool-stats/:type/:interval/:aggregation',
    component: OrdpoolStatsComponent
  },
  {
    path: 'open-timestamps',
    component: OpenTimestampsComponent,
  },
];