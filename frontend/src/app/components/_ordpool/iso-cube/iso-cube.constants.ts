/**
 * Edge length of a timeline block (`.bitcoin-block`) in px. The iso cube
 * overlay renders at 130 % of it, the strip's stride is 124 % of it
 * (block + 0.24 padding, the factor blockchain-blocks and mempool-blocks
 * apply in ngOnChanges) and the container offset is 32 %. Every other
 * timeline measure derives from this one number.
 */
export const timelineBlockSize = 110;
