import { bitmapPerfSuite } from '../_shared/bitmap-3d-perf';

// Desktop branch: SSAA + SAO on, 2048² shadow map, DPR clamped to 2.
bitmapPerfSuite('desktop');
