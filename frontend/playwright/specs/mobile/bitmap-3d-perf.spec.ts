import { bitmapPerfSuite } from '../_shared/bitmap-3d-perf';

// Mobile branch: post-processing skipped, 1024² shadow map, DPR clamped to 1.5.
bitmapPerfSuite('mobile');
